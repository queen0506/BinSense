import { supabase } from '../supabase-init.js';

// Global state to keep dispatch data accessible to the button
let currentOptimizedPath = [];
let currentComplianceScore = 0;

/**
 * Helper for System Logs
 */
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
    // 1. Initialize Professional Map (CartoDB Voyager)
    const map = L.map('map', { zoomControl: false }).setView([14.8350, 120.2840], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap'
    }).addTo(map);

    const markerLayer = L.layerGroup().addTo(map);

    const refreshBins = async () => {
        const { data: bins, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Bin sync failed:', error);
        
        // --- ROUTE OPTIMIZATION LOGIC ---
        currentOptimizedPath = bins
            .filter(b => (b.status?.toLowerCase() === 'full' || (b.level || b.volume || 0) >= 80))
            .sort((a, b) => (b.level || b.volume || 0) - (a.level || a.volume || 0));

        // --- BEHAVIORAL COMPLIANCE TRACKING ---
        const total = bins.length;
        const available = bins.filter(b => b.status?.toLowerCase() === 'available').length;
        currentComplianceScore = total > 0 ? Math.round((available / total) * 100) : 0;

        updateDashboardUI(currentOptimizedPath, currentComplianceScore, markerLayer);
    };
    refreshBins();
    supabase.channel('lgu-collection-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshBins)
        .subscribe();

    // 3. FIXED Dispatch Button Handler
    // Attached once to avoid event duplication/unresponsiveness
    const dispatchBtn = document.getElementById('dispatchBtn');
    if (dispatchBtn) {
        dispatchBtn.onclick = async () => {
            if (currentOptimizedPath.length === 0) {
                alert("No route available for dispatch.");
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
                alert(`Route successfully dispatched to Personnel.\nCompliance Rate: ${currentComplianceScore}%`);
            } catch (error) {
                console.error("Dispatch Error:", error);
                alert("Failed to dispatch route. Please check your connection.");
            }
        };
    }
});

/**
 * Updates the Map and Route List UI
 */
function updateDashboardUI(path, score, markerLayer) {
    markerLayer.clearLayers();
    
    // Update Stats
    document.getElementById('binsToCollect').innerText = path.length;
    document.getElementById('complianceScore').innerText = `${score}%`;
    document.getElementById('route-status').innerText = path.length > 0 ? "Optimization Active" : "All Clear";

    const container = document.getElementById('routeContainer');
    const dispatchBtn = document.getElementById('dispatchBtn');
    
    container.innerHTML = "";

    if (path.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#999; font-size:0.8rem;">
             All communities compliant. No urgent routes detected.
        </p>`;
        dispatchBtn.style.display = 'none';
        return;
    }

    dispatchBtn.style.display = 'block';

    path.forEach((bin, index) => {
        const stopNum = index + 1;
        
        // Add Marker to Map
        const markerColor = (bin.level || bin.volume || 0) >= 90 ? '#ff4444' : '#fc1111';
        L.circleMarker([bin.lat || 14.8350, bin.lng || 120.2840], {
            radius: 10, fillColor: markerColor, color: "#fff", weight: 3, fillOpacity: 0.9
        }).addTo(markerLayer).bindPopup(`<b>Stop #${stopNum}:</b> Brgy. ${bin.barangay}`);

        // Inject Route Card
        container.innerHTML += `
            <div class="route-card" style="border-left: 5px solid ${markerColor}">
                <div class="stop-number">${stopNum}</div>
                <div class="card-details">
                    <h4>Brgy. ${bin.barangay || 'Unknown'}</h4>
                    <p>Status: ${bin.status || 'Active'}</p>
                </div>
                <div class="load-tag">${bin.level || bin.volume || 0}%</div>
            </div>
        `;
    });
}