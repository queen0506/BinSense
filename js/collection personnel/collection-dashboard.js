// collection-dashboard.js
import { supabase } from '../supabase-init.js';

let map, directionsService, directionsRenderer, truckMarker, infoWindow;
let binMarkers = []; 
let currentTruckPos = null;
let pendingBinId = null; // Track bin awaiting confirmation

// FIX 1: Explicitly attach to window so Google Maps API can find it
window.initMap = function() {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true, // We use custom markers
        polylineOptions: { strokeColor: "#99cc33", strokeWeight: 5 }
    });
    infoWindow = new google.maps.InfoWindow();
    
    map = new google.maps.Map(document.getElementById("map-container"), {
        zoom: 15,
        center: { lat: 14.8354, lng: 120.2842 },
        disableDefaultUI: true 
    });

    directionsRenderer.setMap(map);
    trackTruckLocation();
    listenForFullBins(); // Start passive monitoring
};

function trackTruckLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition((position) => {
            currentTruckPos = { lat: position.coords.latitude, lng: position.coords.longitude };
            
            if (truckMarker) {
                truckMarker.setPosition(currentTruckPos);
            } else {
                truckMarker = new google.maps.Marker({
                    position: currentTruckPos,
                    map: map,
                    icon: { url: "https://maps.google.com/mapfiles/kml/shapes/truck.png", scaledSize: new google.maps.Size(35, 35) }
                });
            }
            listenForAdminDispatch();
        }, null, { enableHighAccuracy: true });
    }
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
            clearMap();
            const placeholder = document.querySelector('.map-placeholder');
            if (placeholder) {
                placeholder.style.display = 'flex';
                placeholder.innerHTML = "<p>✅ All bins collected!</p>";
            }
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
        const binWaypoints = [];
        clearMarkers();

        dispatchData.bin_ids.forEach(binId => {
            const bin = allBins.get(binId);
            if (bin && bin.status?.toLowerCase() === 'full') {
                const pos = { lat: Number(bin.lat), lng: Number(bin.lng) };
                binWaypoints.push(pos);
                const marker = new google.maps.Marker({
                    position: pos,
                    map: map,
                    icon: { url: "../../logo/bin.png", scaledSize: new google.maps.Size(35, 35) }
                });

                marker.addListener("click", () => {
                    infoWindow.setContent(`
                        <div style="padding:10px; font-family: sans-serif; text-align:center;">
                            <h4 style="margin:0 0 8px 0;">Brgy. ${bin.barangay}</h4>
                            <button onclick="showConfirmationModal('${binId}')" style="background:#99cc33; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold;">
                                Mark as Collected
                            </button>
                        </div>
                    `);
                    infoWindow.open(map, marker);
                });
                binMarkers.push(marker);
            }
        });

        if (binWaypoints.length > 0 && currentTruckPos) {
            calculateSmartGPSRoute(currentTruckPos, binWaypoints);
        }
    };

    refreshDispatch();
    supabase.channel('collector-dispatch')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_dispatch' }, refreshDispatch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshDispatch)
        .subscribe();
}

// IMPROVED: Modal Handling and Confirmation Logic
window.showConfirmationModal = function(binId) {
    pendingBinId = binId;
    document.getElementById('confirmModal').style.display = 'flex';
    if (infoWindow) infoWindow.close();
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
            status: "Available",
            last_collected: collectedAt
        }).eq('id', binId);
        if (updateError) throw updateError;

        // 2. Log for Audit
        const { error: logError } = await supabase.from('collection_logs').insert({
            bin_id: binId,
            barangay: binData.barangay || "Unknown",
            collected_at: collectedAt,
            waste_level_at_collection: binData.level || 0,
            personnel_location: currentTruckPos,
            action: "Collection Completed"
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
        console.error("Collection process failed:", err);
    }
}

function calculateSmartGPSRoute(origin, binLocations) {
    const destination = binLocations[binLocations.length - 1];
    const waypoints = binLocations.slice(0, -1).map(loc => ({
        location: new google.maps.LatLng(loc.lat, loc.lng),
        stopover: true
    }));

    directionsService.route({
        origin: origin,
        destination: destination,
        waypoints: waypoints,
        optimizeWaypoints: true, // Shortest route optimization
        travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === "OK") {
            directionsRenderer.setDirections(result);
            const placeholder = document.querySelector('.map-placeholder');
            if (placeholder) {
                placeholder.style.display = 'none';
            }
        }
    });
}

function clearMarkers() {
    binMarkers.forEach(m => m.setMap(null));
    binMarkers = [];
}

function clearMap() {
    clearMarkers();
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
}

// EXISTING: Passive monitoring remains untouched
let fullBinMarkers = [];
function listenForFullBins() {
    const refreshFullBins = async () => {
        const { data: allBins, error } = await supabase.from('bins').select('*');
        if (error) {
            console.error('Full bin sync failed:', error);
            return;
        }
        fullBinMarkers.forEach(m => m.setMap(null));
        fullBinMarkers = [];
        (allBins || []).forEach(bin => {
            const binId = bin.id;
            const isDispatched = binMarkers.some(m => 
                Math.abs(m.getPosition().lat() - Number(bin.lat)) < 0.0001 && 
                Math.abs(m.getPosition().lng() - Number(bin.lng)) < 0.0001
            );
            if (bin.status?.toLowerCase() === 'full' && !isDispatched) {
                const pos = { lat: Number(bin.lat), lng: Number(bin.lng) };
                const marker = new google.maps.Marker({
                    position: pos,
                    map: map,
                    icon: {
                        url: "../../logo/bin.png",
                        scaledSize: new google.maps.Size(30, 30),
                        anchor: new google.maps.Point(15, 30)
                    },
                    title: `Full Bin - Brgy. ${bin.barangay}`
                });
                marker.addListener("click", () => {
                    infoWindow.setContent(`
                        <div style="padding:10px; font-family: sans-serif; text-align:center;">
                            <h4 style="margin:0 0 5px 0; color:#FF3B30;">⚠️ BIN FULL</h4>
                            <p style="margin:0 0 10px 0;">Brgy. ${bin.barangay}</p>
                            <small>Awaiting Admin Dispatch</small>
                        </div>
                    `);
                    infoWindow.open(map, marker);
                });
                fullBinMarkers.push(marker);
            }
        });
    };

    refreshFullBins();
    supabase.channel('collector-full-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshFullBins)
        .subscribe();
}