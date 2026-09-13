import { supabase } from '../supabase-init.js';

let allBins = [];

// Removed: initNotificationListener function[cite: 11]

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
    } catch (err) { console.error("Log error:", err); }
}

document.addEventListener('DOMContentLoaded', () => {
    const brgySelector = document.getElementById('brgySelector');
    
    // Removed: initNotificationListener call[cite: 11]
    
    const refreshBins = async () => {
        const { data, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Bin sync failed:', error);
        allBins = data || [];
        updateDashboard();
    };
    refreshBins();
    supabase.channel('lgu-monitoring-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshBins)
        .subscribe();

    if (brgySelector) {
        brgySelector.addEventListener('change', updateDashboard);
    }
});

function updateDashboard() {
    const selector = document.getElementById('brgySelector');
    if (!selector) return;

    const selectedBrgy = selector.value;
    const filtered = selectedBrgy === 'all' ? allBins : allBins.filter(b => b.barangay === selectedBrgy);

    document.getElementById('count-available').innerText = filtered.filter(b => b.status?.toLowerCase() === 'available').length;
    document.getElementById('count-filling').innerText = filtered.filter(b => b.status?.toLowerCase() === 'filling').length;
    document.getElementById('count-full').innerText = filtered.filter(b => b.status?.toLowerCase() === 'full').length;

    updateHotspots();
}

function updateHotspots() {
    const hotspotContainer = document.getElementById('hotspotContainer');
    if (!hotspotContainer) return;

    const ranking = {};

    allBins.filter(b => b.status?.toLowerCase() === 'full').forEach(b => {
        ranking[b.barangay] = (ranking[b.barangay] || 0) + 1;
    });

    const sorted = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 3);

    if (sorted.length > 0) {
        hotspotContainer.innerHTML = sorted.map(([brgy, count]) => `
            <div class="hotspot-item">
                <div class="hotspot-text-group">
                    <span class="hotspot-brgy">${brgy}</span>
                    <span class="hotspot-count">${count} Bins overflowing</span>
                </div>
                <div class="alert-badge">URGENT</div>
            </div>
        `).join('');
    } else {
        hotspotContainer.innerHTML = `<div class="no-hotspots"><p>All clear.</p></div>`;
    }
}

window.openDetails = (status) => {
    const modal = document.getElementById('detailsModal');
    const container = document.getElementById('binCardsContainer');
    const selector = document.getElementById('brgySelector');
    if (!selector || !modal || !container) return;

    const selectedBrgy = selector.value;
    const matches = allBins.filter(b => b.status?.toLowerCase() === status && (selectedBrgy === 'all' || b.barangay === selectedBrgy));

    document.getElementById('modalTitle').innerText = `${status.toUpperCase()} Bins`;
    container.innerHTML = matches.map(b => `
        <div class="bin-id-card">
            <h4>Smart Bin ID: ${b.id.replace('bin_', '')}</h4>
            <p>Barangay: ${b.barangay}</p>
        </div>
    `).join('');
    modal.style.display = "flex";
};

window.closeModal = () => {
    const modal = document.getElementById('detailsModal');
    if (modal) modal.style.display = "none";
};