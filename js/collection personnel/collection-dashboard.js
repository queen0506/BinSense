// collection-dashboard.js
import { supabase } from '../supabase-init.js';

let map, truckMarker, routeLine;
let binMarkers = [];
let fullBinMarkers = [];
let currentTruckPos = null;
let activeBinWaypoints = [];
let pendingBinId = null; // Track bin awaiting confirmation
let routeRequestId = 0;
let dispatchChannel;
let fullBinsChannel;

const DEFAULT_MAP_CENTER = [14.8354, 120.2842]; // Olongapo City
const BIN_ICON_URL = '../../logo/bin.png';

// Leaflet replaces Google Maps. Supabase queries and the collection modal remain in place.
function initMap() {
    const mapElement = document.getElementById('map-container');
    if (!mapElement || typeof L === 'undefined') {
        console.error('Leaflet could not be loaded. Check the Leaflet CDN scripts.');
        showMapMessage('The map could not be loaded. Please refresh the page.');
        return;
    }

    map = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView(DEFAULT_MAP_CENTER, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Place zoom controls away from the dashboard's top navigation where possible.
    map.zoomControl.setPosition('topright');

    trackTruckLocation();
    listenForAdminDispatch();
    listenForFullBins();

    // The map is inside a responsive layout; recalculate its dimensions after layout settles.
    window.setTimeout(() => map.invalidateSize(), 0);
}

function showMapMessage(message) {
    const placeholder = document.querySelector('.map-placeholder');
    if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.innerHTML = `<p>${message}</p>`;
    }
}

function hideMapMessage() {
    const placeholder = document.querySelector('.map-placeholder');
    if (placeholder) placeholder.style.display = 'none';
}

function trackTruckLocation() {
    if (!navigator.geolocation) {
        showMapMessage('Location is not supported by this browser. Bin locations are still available.');
        return;
    }

    navigator.geolocation.watchPosition((position) => {
        currentTruckPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        const truckIcon = L.divIcon({
            className: 'truck-marker-icon',
            html: '<span aria-label="Your location">🚚</span>',
            iconSize: [38, 38],
            iconAnchor: [19, 19]
        });

        if (truckMarker) {
            truckMarker.setLatLng([currentTruckPos.lat, currentTruckPos.lng]);
        } else {
            truckMarker = L.marker([currentTruckPos.lat, currentTruckPos.lng], {
                icon: truckIcon,
                title: 'Your current location',
                zIndexOffset: 1000
            }).addTo(map).bindPopup('Your current location');
            map.setView([currentTruckPos.lat, currentTruckPos.lng], Math.max(map.getZoom(), 15));
        }

        if (activeBinWaypoints.length > 0) {
            calculateSmartGPSRoute(currentTruckPos, activeBinWaypoints);
        }
    }, (error) => {
        console.warn('Unable to get collector location:', error.message);
        showMapMessage('Allow location access to calculate a route from your current position.');
    }, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000
    });
}

function listenForAdminDispatch() {
    const refreshDispatch = async () => {
        const { data: dispatchData, error: dispatchError } = await supabase
            .from('active_dispatch')
            .select('*')
            .eq('status', 'In Progress')
            .order('dispatched_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (dispatchError) {
            console.error('Dispatch sync failed:', dispatchError);
            return;
        }

        if (!dispatchData || !dispatchData.bin_ids?.length) {
            activeBinWaypoints = [];
            clearMap();
            showMapMessage('✅ No active collection dispatch. Full bins awaiting dispatch will remain visible.');
            return;
        }

        const { data: bins, error: binsError } = await supabase
            .from('bins')
            .select('*')
            .in('id', dispatchData.bin_ids);

        if (binsError) {
            console.error('Bin sync failed:', binsError);
            return;
        }

        const allBins = new Map((bins || []).map(bin => [bin.id, bin]));
        activeBinWaypoints = [];
        clearMarkers();

        dispatchData.bin_ids.forEach(binId => {
            const bin = allBins.get(binId);
            if (!bin || bin.status?.toLowerCase() !== 'full') return;

            const position = getValidBinPosition(bin);
            if (!position) {
                console.warn(`Skipping bin ${binId}: invalid latitude or longitude.`);
                return;
            }

            activeBinWaypoints.push({ ...position, binId, barangay: bin.barangay || 'Unknown' });

            const marker = L.marker([position.lat, position.lng], {
                icon: createBinIcon(35),
                title: `Brgy. ${bin.barangay || 'Unknown'} — Full bin`
            }).addTo(map);

            marker.bindPopup(createCollectionPopup(bin));
            binMarkers.push(marker);
        });

        if (activeBinWaypoints.length > 0) {
            hideMapMessage();
            if (currentTruckPos) {
                calculateSmartGPSRoute(currentTruckPos, activeBinWaypoints);
            } else {
                showMapMessage('Full bins are shown. Allow location access to calculate your collection route.');
                fitMapToMarkers();
            }
        } else {
            clearRoute();
            showMapMessage('No full bins remain in the active dispatch.');
        }
    };

    refreshDispatch();
    if (dispatchChannel) supabase.removeChannel(dispatchChannel);
    dispatchChannel = supabase.channel('collector-dispatch')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_dispatch' }, refreshDispatch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshDispatch)
        .subscribe();
}

function getValidBinPosition(bin) {
    const lat = Number(bin.lat);
    const lng = Number(bin.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }
    return { lat, lng };
}

function createBinIcon(size = 35) {
    return L.icon({
        iconUrl: BIN_ICON_URL,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size + 4]
    });
}

function createCollectionPopup(bin) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bin-popup';
    wrapper.style.cssText = 'padding:8px; font-family:sans-serif; text-align:center;';

    const heading = document.createElement('h4');
    heading.textContent = `Brgy. ${bin.barangay || 'Unknown'}`;
    heading.style.cssText = 'margin:0 0 8px 0;';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mark as Collected';
    button.style.cssText = 'background:#99cc33; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold;';
    button.addEventListener('click', () => window.showConfirmationModal(bin.id));

    wrapper.append(heading, button);
    return wrapper;
}

// Confirmation modal handling remains unchanged in behavior.
window.showConfirmationModal = function(binId) {
    pendingBinId = binId;
    document.getElementById('confirmModal').style.display = 'flex';
    if (map) map.closePopup();
};

document.getElementById('cancelCollect').onclick = () => {
    document.getElementById('confirmModal').style.display = 'none';
    pendingBinId = null;
};

document.getElementById('confirmCollect').onclick = async () => {
    if (pendingBinId) {
        await executeMarkAsCollected(pendingBinId);
        document.getElementById('confirmModal').style.display = 'none';
        pendingBinId = null;
    }
};

async function executeMarkAsCollected(binId) {
    try {
        const { data: binData, error: binError } = await supabase
            .from('bins')
            .select('*')
            .eq('id', binId)
            .single();
        if (binError) throw binError;

        // 1. Reset bin status
        const collectedAt = new Date().toISOString();
        const { error: updateError } = await supabase.from('bins').update({
            level: 0,
            status: 'Available',
            last_collected: collectedAt
        }).eq('id', binId);
        if (updateError) throw updateError;

        // 2. Log for Audit
        const { error: logError } = await supabase.from('collection_logs').insert({
            bin_id: binId,
            barangay: binData.barangay || 'Unknown',
            collected_at: collectedAt,
            waste_level_at_collection: binData.level || 0,
            personnel_location: currentTruckPos,
            action: 'Collection Completed'
        });
        if (logError) throw logError;

        // 3. Remove from Active Dispatch and update route dynamically
        const { data: dispatches, error: dispatchError } = await supabase
            .from('active_dispatch')
            .select('*')
            .eq('status', 'In Progress')
            .contains('bin_ids', [binId]);
        if (dispatchError) throw dispatchError;

        for (const dispatch of dispatches || []) {
            const updatedIds = dispatch.bin_ids.filter(id => id !== binId);
            if (updatedIds.length === 0) {
                const { error } = await supabase.from('active_dispatch')
                    .update({ bin_ids: [], status: 'Completed' })
                    .eq('id', dispatch.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('active_dispatch')
                    .update({ bin_ids: updatedIds })
                    .eq('id', dispatch.id);
                if (error) throw error;
            }
        }
    } catch (err) {
        console.error('Collection process failed:', err);
        alert('The bin could not be marked as collected. Please check your connection and try again.');
    }
}

async function calculateSmartGPSRoute(origin, binLocations) {
    if (!map || !origin || !binLocations?.length) {
        clearRoute();
        return;
    }

    // OSRM Trip optimizes the order of intermediate stops while preserving the first
    // coordinate (collector) and last coordinate (destination) for a one-way trip.
    const locations = [origin, ...binLocations];
    const coordinates = locations.map(point => `${point.lng},${point.lat}`).join(';');
    const requestId = ++routeRequestId;
    const routeUrl = `https://router.project-osrm.org/trip/v1/driving/${coordinates}?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false`;

    try {
        const response = await fetch(routeUrl);
        if (!response.ok) throw new Error(`Routing service returned HTTP ${response.status}`);
        const result = await response.json();
        if (requestId !== routeRequestId) return; // Ignore stale route responses.
        if (result.code !== 'Ok' || !result.trips?.length || !result.trips[0].geometry?.coordinates?.length) {
            throw new Error(result.message || 'No driving route was returned.');
        }

        const routeLatLngs = result.trips[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        if (routeLine) routeLine.remove();
        routeLine = L.polyline(routeLatLngs, {
            color: '#99cc33',
            weight: 5,
            opacity: 0.9
        }).addTo(map);

        hideMapMessage();
        const bounds = routeLine.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
    } catch (error) {
        if (requestId !== routeRequestId) return;
        console.error('Route calculation failed:', error);
        clearRoute();
        showMapMessage('The road route is temporarily unavailable. Bin markers are still shown.');
        fitMapToMarkers();
    }
}

function clearMarkers() {
    binMarkers.forEach(marker => marker.remove());
    binMarkers = [];
}

function clearRoute() {
    routeRequestId += 1; // Invalidate any pending route response.
    if (routeLine) {
        routeLine.remove();
        routeLine = null;
    }
}

function clearMap() {
    clearMarkers();
    clearRoute();
}

function fitMapToMarkers() {
    if (!map) return;
    const points = [];
    if (truckMarker) points.push(truckMarker.getLatLng());
    binMarkers.forEach(marker => points.push(marker.getLatLng()));
    fullBinMarkers.forEach(marker => points.push(marker.getLatLng()));
    if (points.length) map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 16 });
}

// Passive monitoring of full bins that have not yet been dispatched.
function listenForFullBins() {
    const refreshFullBins = async () => {
        const { data: allBins, error } = await supabase.from('bins').select('*');
        if (error) {
            console.error('Full bin sync failed:', error);
            return;
        }

        fullBinMarkers.forEach(marker => marker.remove());
        fullBinMarkers = [];

        (allBins || []).forEach(bin => {
            if (bin.status?.toLowerCase() !== 'full') return;
            const position = getValidBinPosition(bin);
            if (!position) return;

            const isDispatched = binMarkers.some(marker => {
                const markerPosition = marker.getLatLng();
                return Math.abs(markerPosition.lat - position.lat) < 0.0001 &&
                    Math.abs(markerPosition.lng - position.lng) < 0.0001;
            });
            if (isDispatched) return;

            const marker = L.marker([position.lat, position.lng], {
                icon: createBinIcon(30),
                title: `Full Bin - Brgy. ${bin.barangay || 'Unknown'}`
            }).addTo(map);

            const popup = document.createElement('div');
            popup.style.cssText = 'padding:8px; font-family:sans-serif; text-align:center;';
            const heading = document.createElement('h4');
            heading.textContent = '⚠️ BIN FULL';
            heading.style.cssText = 'margin:0 0 5px 0; color:#FF3B30;';
            const barangay = document.createElement('p');
            barangay.textContent = `Brgy. ${bin.barangay || 'Unknown'}`;
            barangay.style.cssText = 'margin:0 0 8px 0;';
            const note = document.createElement('small');
            note.textContent = 'Awaiting Admin Dispatch';
            popup.append(heading, barangay, note);
            marker.bindPopup(popup);
            fullBinMarkers.push(marker);
        });

        if (!activeBinWaypoints.length) fitMapToMarkers();
    };

    refreshFullBins();
    if (fullBinsChannel) supabase.removeChannel(fullBinsChannel);
    fullBinsChannel = supabase.channel('collector-full-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshFullBins)
        .subscribe();
}

initMap();
