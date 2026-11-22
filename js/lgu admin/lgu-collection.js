import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let currentOptimizedPath = [];
let currentComplianceScore = 0;
let etaRequestId = 0;
let etaRefreshTimer = null;
const LGU_DISPATCH_ORIGIN = { lat: 14.8350, lng: 120.2840 };
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

async function loadRouteLocationLabels(path) {
    const binIds = [...new Set(path
        .map(bin => bin.id)
        .filter(binId => typeof binId === 'string' && binId.trim()))];
    if (binIds.length === 0) return new Map();

    try {
        const { data, error } = await supabase.rpc('get_lgu_collection_bin_addresses', {
            p_bin_ids: binIds
        });
        if (error) {
            console.error('Unable to load confirmed Citizen addresses for the LGU route:', error);
            return new Map();
        }

        return new Map((data || [])
            .filter(row => binIds.includes(row.bin_id) &&
                typeof row.location_label === 'string' &&
                row.location_label.trim())
            .map(row => [row.bin_id, row.location_label.trim()]));
    } catch (error) {
        console.error('Unable to load confirmed Citizen addresses for the LGU route:', error);
        return new Map();
    }
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

document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false }).setView([14.8350, 120.2840], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '©OpenStreetMap'
    }).addTo(map);

    const markerLayer = L.layerGroup().addTo(map);

    const refreshBins = async () => {
        const { data: bins, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Bin sync failed:', error);

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
        .subscribe();

    const dispatchBtn = document.getElementById('dispatchBtn');
    if (dispatchBtn) {
        dispatchBtn.onclick = async () => {
            if (currentOptimizedPath.length === 0) {
                showDispatchAlert({
                    type: 'warning',
                    title: 'No Route Available',
                    message: 'There are no full bins to collect right now, so there is nothing to dispatch.'
                });
                return;
            }

            try {
                const { error } = await supabase.from('active_dispatch').insert({
                    bin_ids: currentOptimizedPath.map(b => b.id),
                    dispatched_at: new Date().toISOString(),
                    compliance_score: currentComplianceScore,
                    status: 'In Progress'
                });
                if (error) throw error;

                await writeLog("Dispatch Route", `LGU Personnel dispatched route for ${currentOptimizedPath.length} bins.`);
                showDispatchAlert({
                    type: 'success',
                    title: 'Route Dispatched',
                    message: `Route for ${currentOptimizedPath.length} bin${currentOptimizedPath.length === 1 ? '' : 's'} was successfully sent to the waste collector.`,
                    stat: { label: 'Compliance Rate', value: `${currentComplianceScore}%` }
                });
            } catch (error) {
                console.error("Dispatch Error:", error);
                showDispatchAlert({
                    type: 'error',
                    title: 'Dispatch Failed',
                    message: 'We could not dispatch the route. Please check your connection and try again.'
                });
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
    if (path.length) {
        try {
            const coords = [LGU_DISPATCH_ORIGIN, ...path.map(bin => ({
                lng: Number(bin.lng) || LGU_DISPATCH_ORIGIN.lng,
                lat: Number(bin.lat) || LGU_DISPATCH_ORIGIN.lat
            }))].map(point => `${point.lng},${point.lat}`).join(';');
            const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
            if (!response.ok) throw new Error(`Routing service returned HTTP ${response.status}`);
            const result = await response.json();
            const route = result.routes?.[0];
            const legs = route?.legs;
            if (result.code !== 'Ok' || !legs || legs.length !== path.length || legs.some(leg => !Number.isFinite(Number(leg.duration)))) {
                throw new Error('Per-bin route durations are unavailable.');
            }
            routeGeometry = route.geometry;
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

    const locationLabels = await loadRouteLocationLabels(path);
    if (requestId !== etaRequestId) return;

    markerLayer.clearLayers();
    if (routeGeometry) {
        L.geoJSON(routeGeometry, { style: { color: '#4285F4', weight: 5, opacity: 0.8 } }).addTo(markerLayer);
    }

    document.getElementById('binsToCollect').innerText = path.length;
    document.getElementById('complianceScore').innerText = `${score}%`;
    document.getElementById('route-status').innerText = path.length > 0 ? "Optimization Active" : "All Clear";

    const container = document.getElementById('routeContainer');
    const dispatchBtn = document.getElementById('dispatchBtn');
    const etaSummary = document.getElementById('etaSummary');

    container.innerHTML = "";

    if (path.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#999; font-size:0.8rem;">
             All communities compliant. No urgent routes detected.
        </p>`;
        dispatchBtn.style.display = 'none';
        if (etaSummary) etaSummary.textContent = 'No route ETA: there are no bins to collect.';
        return;
    }

    dispatchBtn.style.display = 'block';
    if (etaSummary) {
        etaSummary.textContent = etaTimes?.length
            ? `Estimated Final Arrival: ${etaTimes[etaTimes.length - 1]}`
            : 'Route ETA is unavailable. Check the routing connection.';
    }

    path.forEach((bin, index) => {
        const stopNum = index + 1;
        const locationLabel = escapeHtml(
            locationLabels.get(bin.id) || UNASSIGNED_LOCATION_LABEL
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

        L.marker([bin.lat || 14.8350, bin.lng || 120.2840], { icon: binIcon })
            .addTo(markerLayer)
            .bindPopup(`<b>Stop #${stopNum}:</b> ${locationLabel}<br><b>Estimated Time of Arrival:</b> ${etaTimes?.[index] || 'Unavailable'}`);

        container.innerHTML += `
            <div class="route-card" style="border-left: 5px solid ${markerColor}">
                <div class="stop-number">${stopNum}</div>
                <div class="card-details">
                    <h4>${locationLabel}</h4>
                    <p>Status: ${bin.status || 'Active'}</p>
                    <p style="font-size:0.8em; color:#666; margin-top:4px;">Estimated Time of Arrival: <b>${etaTimes?.[index] || 'Unavailable'}</b></p>
                </div>
                <div class="load-tag">${bin.level || bin.volume || 0}%</div>
            </div>
        `;
    });

    etaRefreshTimer = setInterval(() => {
        updateDashboardUI(currentOptimizedPath, currentComplianceScore, markerLayer, map);
    }, 60000);
}