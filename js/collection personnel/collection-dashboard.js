import { getBinLocationLabel, getValidBinPosition } from '../bin-location.js';
// collection-dashboard.js
import { supabase } from '../supabase-init.js';

let map, truckMarker, routeLine;
let binMarkers = [];
let fullBinMarkers = [];
let currentTruckPos = null;
let activeBinWaypoints = [];
let pendingBinId = null; 
let routeRequestId = 0;
let dispatchChannel;
let fullBinsChannel;

const DEFAULT_MAP_CENTER = [14.8354, 120.2842]; // Olongapo City

function initMap() {
    const mapElement = document.getElementById('map-container');
    if (!mapElement || typeof L === 'undefined') {
        console.error('Leaflet could not be loaded.');
        showMapMessage('The map could not be loaded. Please refresh the page.');
        return;
    }

    map = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView(DEFAULT_MAP_CENTER, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    map.zoomControl.setPosition('topright');

    trackTruckLocation();
    listenForAdminDispatch();
    listenForFullBins();

    // Keep Leaflet's viewport in sync with responsive layout and orientation changes.
    const invalidateMapSize = () => {
        window.requestAnimationFrame(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    };
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(invalidateMapSize).observe(mapElement);
    }
    window.addEventListener('resize', invalidateMapSize);
    window.addEventListener('orientationchange', invalidateMapSize);
    window.setTimeout(invalidateMapSize, 0);
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

function setEtaPanel(message, stops = [], visible = true) {
    const panel = document.getElementById('etaPanel');
    const status = document.getElementById('eta-panel-status');
    const list = document.getElementById('eta-list');
    if (!panel || !status || !list) return;
    
    panel.style.display = visible ? 'flex' : 'none';
    status.textContent = message;
    
    if (stops.length === 0) {
        const totalDriveTime = document.getElementById('totalDriveTime');
        const finalArrivalTime = document.getElementById('finalArrivalTime');
        if (totalDriveTime) totalDriveTime.textContent = '--';
        if (finalArrivalTime) finalArrivalTime.textContent = '--:--';
    }
    
    list.replaceChildren(...stops.map(stop => {
        const item = document.createElement('li');
        item.textContent = `${stop.location}: ${stop.eta}`;
        return item;
    }));
}

function initEtaPanelToggle() {
    const panel = document.getElementById('etaPanel');
    const toggle = document.getElementById('etaPanelToggle');
    if (!panel || !toggle) return;

    const mobileLayout = window.matchMedia('(max-width: 899px)');
    let wasMobile = mobileLayout.matches;

    const syncLayout = () => {
        const isMobile = mobileLayout.matches;
        if (isMobile && !wasMobile) panel.classList.add('collapsed');
        if (!isMobile) panel.classList.remove('collapsed');
        wasMobile = isMobile;

        const expanded = !panel.classList.contains('collapsed');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Collapse route stops' : 'Expand route stops');
    };

    toggle.addEventListener('click', () => {
        if (!mobileLayout.matches) return;
        const collapsed = panel.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expand route stops' : 'Collapse route stops');
    });

    window.addEventListener('resize', syncLayout);
    syncLayout();
}

function trackTruckLocation() {
    if (!navigator.geolocation) {
        setEtaPanel('Location is unavailable. Enable GPS to calculate route ETAs.');
        showMapMessage('Location is not supported by this browser.');
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
        setEtaPanel('Allow location access to calculate ETAs.');
        showMapMessage('Allow location access to calculate a route.');
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

        if (dispatchError) return console.error('Dispatch sync failed:', dispatchError);

        if (!dispatchData || !dispatchData.bin_ids?.length) {
            activeBinWaypoints = [];
            clearMap();
            setEtaPanel('No active collection route.');
            showMapMessage('✅ No active collection dispatch.');
            return;
        }

        const { data: bins, error: binsError } = await supabase
            .from('bins')
            .select('*')
            .in('id', dispatchData.bin_ids);

        if (binsError) return console.error('Bin sync failed:', binsError);

        const allBins = new Map((bins || []).map(bin => [bin.id, bin]));
        activeBinWaypoints = [];
        clearMarkers();

        dispatchData.bin_ids.forEach(binId => {
            const bin = allBins.get(binId);
            if (!bin || bin.status?.toLowerCase() !== 'full') return;

            const position = getValidBinPosition(bin);
            if (!position) return;

            activeBinWaypoints.push({ ...position, binId, barangay: bin.barangay, street: bin.street });

            const marker = L.marker([position.lat, position.lng], {
                icon: createBinIcon(35),
                title: `${getBinLocationLabel(bin)} — Full bin`
            }).addTo(map);

            marker.bindPopup(createCollectionPopup(bin));
            binMarkers.push(marker);
        });

        if (activeBinWaypoints.length > 0) {
            hideMapMessage();
            if (currentTruckPos) {
                calculateSmartGPSRoute(currentTruckPos, activeBinWaypoints);
            } else {
                setEtaPanel('Waiting for your GPS location...');
                showMapMessage('Full bins are shown. Allow location access to calculate route.');
                fitMapToMarkers();
            }
        } else {
            clearRoute();
            setEtaPanel('No full bins remain in the active dispatch.');
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

function createBinIcon(size = 35) {
    return L.divIcon({
        className: '',
        html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                     width="${size}" height="${size}" aria-label="Waste bin">
            <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-3 5h14l-1 13H6L5 8Z"
                  fill="#e53935"/>
            <path d="M9 10v8m6-8v8" fill="none" stroke="#fff"
                  stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size + 4]
    });
}

function createCollectionPopup(bin, etaText = 'Calculating ETA…') {
    const wrapper = document.createElement('div');
    wrapper.className = 'bin-popup';
    wrapper.style.cssText = 'padding:8px; font-family:sans-serif; text-align:center;';

    const heading = document.createElement('h4');
    heading.textContent = `${getBinLocationLabel(bin)}`;
    heading.style.cssText = 'margin:0 0 2px 0;';

    wrapper.append(heading);

    const eta = document.createElement('p');
    eta.className = 'bin-eta';
    eta.textContent = `ETA: ${etaText}`;
    eta.style.cssText = 'margin:0 0 10px 0; font-weight:bold; color:#527a1a;';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mark as Collected';
    button.style.cssText = 'background:#99cc33; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold;';
    button.addEventListener('click', () => window.showConfirmationModal(bin.id));

    wrapper.append(eta, button);
    return wrapper;
}

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
        const binId = pendingBinId;
        pendingBinId = null;
        document.getElementById('confirmModal').style.display = 'none';

        const success = await executeMarkAsCollected(binId);
        if (success) {
            showCollectionAlert('success', 'Bin Collected Successfully!', 'The bin has been marked as collected and the route was updated.');
        } else {
            showCollectionAlert('error', 'Collection Failed', 'The bin could not be marked as collected. Please check your connection.');
        }
    }
};

// Styled pop-up (replaces the browser alert)
function showCollectionAlert(type, title, message) {
    const modal = document.getElementById('collectAlert');
    const box = modal.querySelector('.alert-box');
    const icon = document.getElementById('collectAlertIcon');
    const btn = document.getElementById('collectAlertClose');

    box.classList.toggle('error', type === 'error');
    icon.innerHTML = type === 'error'
        ? '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>'
        : '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></svg>';
    document.getElementById('collectAlertTitle').textContent = title;
    document.getElementById('collectAlertMessage').textContent = message;

    modal.classList.add('show');
    btn.onclick = () => modal.classList.remove('show');
}

async function executeMarkAsCollected(binId) {
    try {
        const { data: binData, error: binError } = await supabase.from('bins').select('*').eq('id', binId).single();
        if (binError) throw binError;

        const collectedAt = new Date().toISOString();
        const { error: updateError } = await supabase.from('bins').update({
            level: 0,
            status: 'Available',
            last_collected: collectedAt
        }).eq('id', binId);
        if (updateError) throw updateError;

        const { error: logError } = await supabase.from('collection_logs').insert({
            bin_id: binId,
            barangay: binData.barangay || 'Unknown',
            collected_at: collectedAt,
            waste_level_at_collection: binData.level || 0,
            personnel_location: currentTruckPos,
            action: 'Collection Completed'
        });
        if (logError) throw logError;

        const { data: dispatches, error: dispatchError } = await supabase
            .from('active_dispatch')
            .select('*')
            .eq('status', 'In Progress')
            .contains('bin_ids', [binId]);
        if (dispatchError) throw dispatchError;

        for (const dispatch of dispatches || []) {
            const updatedIds = dispatch.bin_ids.filter(id => id !== binId);
            if (updatedIds.length === 0) {
                const { error } = await supabase.from('active_dispatch').update({ bin_ids: [], status: 'Completed' }).eq('id', dispatch.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('active_dispatch').update({ bin_ids: updatedIds }).eq('id', dispatch.id);
                if (error) throw error;
            }
        }
        return true;
    } catch (err) {
        console.error('Collection process failed:', err);
        return false;
    }
}

async function calculateSmartGPSRoute(origin, binLocations) {
    if (!map || !origin || !binLocations?.length) {
        clearRoute();
        return;
    }
    setEtaPanel('Calculating route ETAs...');

    const locations = [origin, ...binLocations];
    const coordinates = locations.map(point => `${point.lng},${point.lat}`).join(';');
    const requestId = ++routeRequestId;
    const routeUrl = `https://router.project-osrm.org/trip/v1/driving/${coordinates}?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false`;

    try {
        const response = await fetch(routeUrl);
        if (!response.ok) throw new Error(`Routing service returned HTTP ${response.status}`);
        const result = await response.json();
        if (requestId !== routeRequestId) return; 
        if (result.code !== 'Ok' || !result.trips?.length || !result.trips[0].geometry?.coordinates?.length) {
            throw new Error('No driving route was returned.');
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

        const trip = result.trips[0];
        const orderedBins = binLocations
            .map((bin, index) => ({ bin, order: result.waypoints?.[index + 1]?.waypoint_index ?? index + 1 }))
            .sort((a, b) => a.order - b.order);
        
        const rawDriveSeconds = Number(trip.duration);
        const totalDriveSeconds = rawDriveSeconds * 1.5; 
        
        const serviceTimePerStopSeconds = 5 * 60; // 5 mins
        const avgDriveSecondsPerStop = totalDriveSeconds / orderedBins.length;
        
        let etaAt = Date.now();
        const etaStops = [];

        orderedBins.forEach(({ bin }, index) => {
            etaAt += avgDriveSecondsPerStop * 1000;
            
            
            if (index < orderedBins.length - 1) {
                etaAt += serviceTimePerStopSeconds * 1000; 
            }
            
            const etaText = new Date(etaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            etaStops.push({ location: getBinLocationLabel(bin), eta: etaText });

            const marker = binMarkers.find(candidate => {
                const position = candidate.getLatLng();
                return Math.abs(position.lat - bin.lat) < 0.0001 && Math.abs(position.lng - bin.lng) < 0.0001;
            });
            if (marker) marker.setPopupContent(createCollectionPopup({ ...bin, id: bin.binId }, etaText));
        });
        
        const totalDriveTime = document.getElementById('totalDriveTime');
        const finalArrivalTime = document.getElementById('finalArrivalTime');
        
        
        if (totalDriveTime) totalDriveTime.textContent = String(Math.ceil(totalDriveSeconds / 60));
        if (finalArrivalTime) finalArrivalTime.textContent = etaStops[etaStops.length - 1]?.eta || '--:--';
        
        setEtaPanel(`Total stops: ${orderedBins.length}`, etaStops);

        // ETA Bubble 
        const etaBubble = document.getElementById('etaBubble');
        if (etaBubble) {
            const lastBin = orderedBins[orderedBins.length - 1].bin;
            const finalEta = etaStops[etaStops.length - 1].eta;
            
            const placeBubble = () => {
                const pt = map.latLngToContainerPoint([lastBin.lat, lastBin.lng]);
                etaBubble.style.left = `${pt.x}px`;
                etaBubble.style.top = `${pt.y - 25}px`; 
            };
            
            etaBubble.style.display = 'block';
            etaBubble.innerText = `Arrive by ${finalEta}`;
            placeBubble();
            
            map.off('move zoom', placeBubble);
            map.on('move zoom', placeBubble);
        }

    } catch (error) {
        if (requestId !== routeRequestId) return;
        console.error('Route calculation failed:', error);
        clearRoute();
        setEtaPanel('Could not calculate ETAs. Check connection.', [], false);
        showMapMessage('The road route is temporarily unavailable.');
        fitMapToMarkers();
    }
}

function clearMarkers() {
    binMarkers.forEach(marker => marker.remove());
    binMarkers = [];
}

function clearRoute() {
    routeRequestId += 1; 
    if (routeLine) {
        routeLine.remove();
        routeLine = null;
    }
    const etaBubble = document.getElementById('etaBubble');
    if (etaBubble) etaBubble.style.display = 'none';
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

function listenForFullBins() {
    const refreshFullBins = async () => {
        const { data: allBins, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Full bin sync failed:', error);

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
                title: `Full Bin - ${getBinLocationLabel(bin)}`
            }).addTo(map);

            const popup = document.createElement('div');
            popup.style.cssText = 'padding:8px; font-family:sans-serif; text-align:center;';
            const heading = document.createElement('h4');
            heading.textContent = '⚠️ BIN FULL';
            heading.style.cssText = 'margin:0 0 5px 0; color:#FF3B30;';
            const barangay = document.createElement('p');
            barangay.textContent = `${getBinLocationLabel(bin)}`;
            barangay.style.cssText = 'margin:0 0 2px 0;';

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

initEtaPanelToggle();
initMap();