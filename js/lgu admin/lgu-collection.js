import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let currentOptimizedPath = []; // ALL full bins (dispatched or not), in optimized stop order
let dispatchedBinIds = new Set();
let lastFitKey = '';
let currentComplianceScore = 0;
let etaRequestId = 0;
let etaRefreshTimer = null;
const LGU_DISPATCH_ORIGIN = { lat: 14.835450894364168, lng: 120.28780553731539 }; // Same fallback the Waste Collector map uses: the bin's own street/barangay.

const UNASSIGNED_LOCATION_LABEL = 'Location not assigned';

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// Same fallback the Waste Collector map uses: the bin's own street/barangay. const LGU_DISPATCH_ORIGIN = { lat: 14.835450894364168, lng: 120.28780553731539 };
function getBinInstallationAddress(bin) {
    const parts = [bin.street, bin.barangay]
        .map(value => String(value || '').trim())
        .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));

    return parts.join(', ') || UNASSIGNED_LOCATION_LABEL;
}

async function loadRouteLocationLabels(path) {
    const binIds = [...new Set(path
        .map(bin => bin.id)
        .filter(binId => typeof binId === 'string' && binId.trim()))];
    if (binIds.length === 0) return new Map();

    const labels = new Map();

    try {
        const { data, error } = await supabase.rpc('get_lgu_collection_bin_addresses', {
            p_bin_ids: binIds
        });
        if (!error) {
            (data || [])
                .filter(row => binIds.includes(row.bin_id) &&
                    typeof row.location_label === 'string' &&
                    row.location_label.trim())
                .forEach(row => labels.set(row.bin_id, row.location_label.trim()));
        } else {
            console.warn('Unable to load confirmed Citizen addresses for the LGU route:', error);
        }
    } catch (error) {
        console.error('Unable to load confirmed Citizen addresses for the LGU route:', error);
    }

    const unresolvedIds = binIds.filter(binId => !labels.has(binId));
    if (!unresolvedIds.length) return labels;

    try {
        const [{ data: connections, error: connectionError }, { data: bins, error: binError }] = await Promise.all([
            supabase.from('user_connected_bins').select('bin_id, user_id').in('bin_id', unresolvedIds),
            supabase.from('bins').select('id, street, barangay').in('id', unresolvedIds)
        ]);

        if (!binError) {
            (bins || []).forEach(bin => {
                const parts = [bin.street, bin.barangay]
                    .map(value => String(value || '').trim())
                    .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));
                if (parts.length) labels.set(bin.id, parts.join(', '));
            });
        }

        if (!connectionError) {
            const userIdsByBin = new Map();
            (connections || []).forEach(connection => {
                const userIds = userIdsByBin.get(connection.bin_id) || [];
                userIds.push(connection.user_id);
                userIdsByBin.set(connection.bin_id, userIds);
            });

            const uniqueConnections = [];
            userIdsByBin.forEach((userIds, binId) => {
                if (new Set(userIds).size === 1) {
                    uniqueConnections.push({ binId, userId: userIds[0] });
                }
            });
            if (!uniqueConnections.length) return labels;

            const { data: profiles, error: profileError } = await supabase
                .from('users')
                .select('id, role, address_confirmed, house_number, street_name, barangay, city_municipality, province')
                .in('id', [...new Set(uniqueConnections.map(connection => connection.userId))]);

            if (!profileError) {
                const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
                uniqueConnections.forEach(({ binId, userId }) => {
                    const profile = profilesById.get(userId);
                    if (String(profile?.role || '').trim().toLowerCase() !== 'citizen' ||
                        profile.address_confirmed !== true) return;

                    const houseAndStreet = [profile.house_number, profile.street_name]
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                        .join(' ');
                    const addressParts = [
                        houseAndStreet,
                        profile.barangay,
                        profile.city_municipality,
                        profile.province
                    ].map(value => String(value || '').trim())
                        .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));
                    if (addressParts.length) labels.set(binId, addressParts.join(', '));
                });
            }
        }
    } catch (fallbackError) {
        console.error('Unable to load fallback bin/Citizen addresses:', fallbackError);
    }

    return labels;
}

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

/* ===== Dispatch alert ===== */
const ALERT_ICONS = {
    success: '<path d="M5 13l4 4L19 7"/>',
    error: '<path d="M6 6l12 12M18 6L6 18"/>',
    warning: '<path d="M12 8v5M12 17h.01"/>'
};

function showDispatchAlert({ type = 'success', title, message, stat }) {
    document.querySelector('.dispatch-alert-overlay')?.remove();
    const opener = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'dispatch-alert-overlay';
    overlay.innerHTML = `
        <div class="dispatch-alert" data-type="${type}" role="alertdialog" aria-modal="true"
             aria-labelledby="dispatch-alert-title" aria-describedby="dispatch-alert-message">
            <div class="dispatch-alert-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">${ALERT_ICONS[type] || ALERT_ICONS.success}</svg>
            </div>
            <h2 class="dispatch-alert-title" id="dispatch-alert-title"></h2>
            <p class="dispatch-alert-message" id="dispatch-alert-message"></p>
            <div class="dispatch-alert-stat" hidden><span></span><strong></strong></div>
            <button type="button" class="dispatch-alert-btn">Got It</button>
        </div>
    `;

    overlay.querySelector('.dispatch-alert-title').textContent = title;
    overlay.querySelector('.dispatch-alert-message').textContent = message;
    if (stat) {
        const statEl = overlay.querySelector('.dispatch-alert-stat');
        statEl.hidden = false;
        statEl.querySelector('span').textContent = stat.label;
        statEl.querySelector('strong').textContent = stat.value;
    }

    const close = () => {
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('is-open');
        setTimeout(() => {
            overlay.remove();
            if (opener?.isConnected) opener.focus();
        }, 200);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };

    const button = overlay.querySelector('.dispatch-alert-btn');
    button.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    button.focus();
}

async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        await supabase.from('system_logs').insert({
            email: user.email,
            action,
            message,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Log error:", err);
    }
}

async function fetchActiveDispatch() {
    const { data, error } = await supabase
        .from('active_dispatch')
        .select('*')
        .eq('status', 'In Progress')
        .order('dispatched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false }).setView([14.8350, 120.2840], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '©OpenStreetMap'
    }).addTo(map);

    const markerLayer = L.layerGroup().addTo(map);

    const refreshBins = async () => {
        const { data: bins, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Bin sync failed:', error);

        // Bins already sent to the collector must not be offered for dispatch again.
        let dispatchedIds = new Set();
        try {
            const activeDispatch = await fetchActiveDispatch();
            dispatchedIds = new Set(activeDispatch?.bin_ids || []);
        } catch (dispatchError) {
            console.error('Active dispatch sync failed:', dispatchError);
        }
        dispatchedBinIds = dispatchedIds;

        // Dispatched full bins stay on the map until the collector marks them collected.
        currentOptimizedPath = bins
            .filter(bin => bin.status?.toLowerCase() === 'full')
            .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));

        const total = bins.length;
        const available = bins.filter(b => b.status?.toLowerCase() === 'available').length;
        currentComplianceScore = total > 0 ? Math.round((available / total) * 100) : 0;

        updateDashboardUI(currentOptimizedPath, currentComplianceScore, markerLayer, map);
    };

    refreshBins();

    supabase.channel('lgu-collection-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_dispatch' }, refreshBins)
        .subscribe();

    const dispatchBtn = document.getElementById('dispatchBtn');
    if (dispatchBtn) {
        dispatchBtn.onclick = async () => {
            // Only bins not already sent to the collector are dispatched.
            const routeBins = currentOptimizedPath.filter(bin => !dispatchedBinIds.has(bin.id));
            if (routeBins.length === 0) {
                showDispatchAlert({
                    type: 'warning',
                    title: 'No Route Available',
                    message: 'There are no undispatched full bins to collect right now, so there is nothing to dispatch.'
                });
                return;
            }

            dispatchBtn.disabled = true;
            const routeIds = routeBins.map(b => b.id);

            try {
                // The collector reads only ONE "In Progress" dispatch, so add to it
                // instead of inserting a second row that would hide the first.
                const existing = await fetchActiveDispatch();
                if (existing) {
                    const mergedIds = [...new Set([...(existing.bin_ids || []), ...routeIds])];
                    const { error } = await supabase.from('active_dispatch').update({
                        bin_ids: mergedIds,
                        dispatched_at: new Date().toISOString(),
                        compliance_score: currentComplianceScore
                    }).eq('id', existing.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase.from('active_dispatch').insert({
                        bin_ids: routeIds,
                        dispatched_at: new Date().toISOString(),
                        compliance_score: currentComplianceScore,
                        status: 'In Progress'
                    });
                    if (error) throw error;
                }

                await writeLog("Dispatch Route", `LGU Personnel dispatched route for ${routeIds.length} bins.`);
                showDispatchAlert({
                    type: 'success',
                    title: 'Route Dispatched',
                    message: `Route for ${routeIds.length} bin${routeIds.length === 1 ? '' : 's'} was successfully sent to the waste collector.`,
                    stat: { label: 'Compliance Rate', value: `${currentComplianceScore}%` }
                });
            } catch (error) {
                console.error("Dispatch Error:", error);
                showDispatchAlert({
                    type: 'error',
                    title: 'Dispatch Failed',
                    message: 'We could not dispatch the route. Please check your connection and try again.'
                });
            } finally {
                dispatchBtn.disabled = false;
            }
        };
    }
});

async function updateDashboardUI(path, score, markerLayer, map) {
    if (etaRefreshTimer) {
        clearInterval(etaRefreshTimer);
        etaRefreshTimer = null;
    }
    const requestId = ++etaRequestId;
    let etaTimes = null;
    let routeGeometry = null;
    let orderedPath = path;

    if (path.length) {
        try {
            // Use the same optimizer as the collector map (OSRM /trip) so the stop
            // order previewed here matches the route the collector receives.
            const points = [LGU_DISPATCH_ORIGIN, ...path.map(bin => ({
                lng: Number(bin.lng) || LGU_DISPATCH_ORIGIN.lng,
                lat: Number(bin.lat) || LGU_DISPATCH_ORIGIN.lat
            }))];
            const coords = points.map(point => `${point.lng},${point.lat}`).join(';');
            const response = await fetch(`https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=any&overview=full&geometries=geojson&steps=false`);
            if (!response.ok) throw new Error(`Routing service returned HTTP ${response.status}`);
            const result = await response.json();
            const trip = result.trips?.[0];
            const legs = trip?.legs;
            if (result.code !== 'Ok' || !legs || legs.length !== path.length ||
                legs.some(leg => !Number.isFinite(Number(leg.duration))) ||
                !Array.isArray(result.waypoints) || result.waypoints.length !== path.length + 1) {
                throw new Error('Per-bin route durations are unavailable.');
            }

            orderedPath = path
                .map((bin, index) => ({ bin, order: result.waypoints[index + 1].waypoint_index }))
                .sort((a, b) => a.order - b.order)
                .map(entry => entry.bin);

            routeGeometry = trip.geometry;
            let arrivalAt = Date.now();
            etaTimes = legs.map((leg, index) => {
                arrivalAt += Number(leg.duration) * 1000;
                const eta = new Date(arrivalAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                if (index < legs.length - 1) arrivalAt += 5 * 60 * 1000;
                return eta;
            });
        } catch (error) {
            console.warn('Could not calculate LGU route ETAs:', error);
        }
    }
    if (requestId !== etaRequestId) return;

    const locationLabels = await loadRouteLocationLabels(orderedPath);
    if (requestId !== etaRequestId) return;

    // Keep the module-level list in the order that will actually be dispatched.
    currentOptimizedPath = orderedPath;

    markerLayer.clearLayers();
    if (routeGeometry) {
        L.geoJSON(routeGeometry, { style: { color: '#4285F4', weight: 5, opacity: 0.8 } }).addTo(markerLayer);
    }

    const pendingCount = orderedPath.filter(bin => !dispatchedBinIds.has(bin.id)).length;

    markerLayer.clearLayers();
    // Preview the route only while bins are still waiting to be dispatched.
    if (routeGeometry && pendingCount > 0) {
        L.geoJSON(routeGeometry, { style: { color: '#4285F4', weight: 5, opacity: 0.8 } }).addTo(markerLayer);
    }

    document.getElementById('binsToCollect').innerText = orderedPath.length;
    document.getElementById('complianceScore').innerText = `${score}%`;
    document.getElementById('route-status').innerText = orderedPath.length === 0
        ? "All Clear"
        : (pendingCount > 0 ? "Optimization Active" : "Dispatched");

    const container = document.getElementById('routeContainer');
    const dispatchBtn = document.getElementById('dispatchBtn');
    const etaSummary = document.getElementById('etaSummary');

    container.innerHTML = "";

    if (orderedPath.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#999; font-size:0.8rem;">
             All communities compliant. No urgent routes detected.
        </p>`;
        dispatchBtn.style.display = 'none';
        if (etaSummary) etaSummary.textContent = 'No route ETA: there are no bins to collect.';
        lastFitKey = '';
        return;
    }

    // Nothing left to send once every full bin is already with the collector.
    dispatchBtn.style.display = pendingCount > 0 ? 'block' : 'none';
    if (etaSummary) {
        etaSummary.textContent = etaTimes?.length
            ? `Estimated Final Arrival: ${etaTimes[etaTimes.length - 1]}`
            : 'Route ETA is unavailable. Check the routing connection.';
    }

    const boundsPoints = [];
    orderedPath.forEach((bin, index) => {
        const stopNum = index + 1;
        const locationLabel = escapeHtml(
            locationLabels.get(bin.id) || getBinInstallationAddress(bin)
        );

        const markerColor = (bin.level || bin.volume || 0) >= 90 ? '#ff4444' : '#fc1111';

        const binIcon = L.divIcon({
            html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                     width="36" height="36" aria-label="Waste bin">
                <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-3 5h14l-1 13H6L5 8Z"
                      fill="#e53935"/>
                <path d="M9 10v8m6-8v8" fill="none" stroke="#fff"
                      stroke-width="1.5" stroke-linecap="round"/>
            </svg>`,
            className: "",
            iconSize: [36, 36],
            iconAnchor: [18, 32],
            popupAnchor: [0, -32]
        });

        const lat = Number(bin.lat) || LGU_DISPATCH_ORIGIN.lat;
        const lng = Number(bin.lng) || LGU_DISPATCH_ORIGIN.lng;
        boundsPoints.push([lat, lng]);

        L.marker([lat, lng], { icon: binIcon })
            .addTo(markerLayer)
            .bindPopup(`<b>Stop #${stopNum}:</b> ${locationLabel}<br><b>Estimated Time of Arrival:</b> ${etaTimes?.[index] || 'Unavailable'}`);

        container.innerHTML += `
            <div class="route-card" style="border-left: 5px solid ${markerColor}">
                <div class="stop-number">${stopNum}</div>
                <div class="card-details">
                    <h4>${locationLabel}</h4>
                    <p>Status: ${escapeHtml(bin.status || 'Active')}${dispatchedBinIds.has(bin.id) ? ' · Dispatched' : ''}</p>
                    <p style="font-size:0.8em; color:#666; margin-top:4px;">Estimated Time of Arrival: <b>${etaTimes?.[index] || 'Unavailable'}</b></p>
                </div>
                <div class="load-tag">${bin.level || bin.volume || 0}%</div>
            </div>
        `;
    });

    // Frame the route once per set of stops so the 60s refresh doesn't reset the admin's panning.
    const fitKey = orderedPath.map(bin => bin.id).join('|');
    if (fitKey !== lastFitKey) {
        lastFitKey = fitKey;
        const bounds = L.latLngBounds([[LGU_DISPATCH_ORIGIN.lat, LGU_DISPATCH_ORIGIN.lng], ...boundsPoints]);
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
    }

    etaRefreshTimer = setInterval(() => {
        updateDashboardUI(currentOptimizedPath, currentComplianceScore, markerLayer, map);
    }, 60000);
}