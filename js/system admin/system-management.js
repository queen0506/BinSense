import { supabase } from '../supabase-init.js';
let activeBinId = null;
let registrationInProgress = false;

document.addEventListener('DOMContentLoaded', () => {
    // Open Modal
    const addBtn = document.querySelector('.add-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            const modal = document.getElementById('register-modal');
            if (modal) modal.style.display = 'flex';
        };
    }

    // Attach click listener directly to confirm button
    const confirmBtn = document.querySelector('#register-modal .confirm-btn');
    if (confirmBtn) {
        confirmBtn.onclick = (e) => {
            e.preventDefault();
            processRegistration();
        };
    }

    // Attach click listener to cancel button
    const cancelBtn = document.querySelector('#register-modal .cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            closeRegisterModal();
        };
    }

    const removeBtn = document.getElementById('remove-bin-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (activeBinId) removeBin(activeBinId, e);
        });
    }
    
    loadRegisteredBins();

    // Auto-refresh UI every 10 seconds to dynamically update active/offline status based on time
    setInterval(() => {
        if (activeBinId) {
            startLiveUpdate(activeBinId);
        } else {
            loadRegisteredBins();
        }
    }, 10000);
});

// Helper function to dynamically derive connection state from last_sync
function getDeviceOnlineStatus(lastSyncTimestamp, rawStatus) {
    if (String(rawStatus).toLowerCase() === "offline") return 'OFFLINE';
    if (!lastSyncTimestamp) return 'OFFLINE';

    const lastSyncTime = new Date(lastSyncTimestamp).getTime();
    const currentTime = Date.now();
    const OFFLINE_THRESHOLD = 60000; // 60 seconds

    return (currentTime - lastSyncTime < OFFLINE_THRESHOLD) ? 'ACTIVE' : 'OFFLINE';
}

async function loadRegisteredBins() {
    const list = document.getElementById('bins-list');
    if (!list) return;
    
    try {
        const { data, error } = await supabase.from('bins').select('*').order('id');
        if (error) throw error;
        list.innerHTML = ''; 
        
        let total = 0, active = 0, offline = 0;

        if (!data || data.length === 0) {
            updateSummary(0, 0, 0);
            return;
        }

        for (const bin of data) {
            if (!bin) continue;

            const binId = bin.id;
            total++;

            // Dynamically calculate status instead of hardcoding
            const calculatedStatus = getDeviceOnlineStatus(bin.last_sync, bin.status);
            const isOffline = calculatedStatus === 'OFFLINE';

            if (isOffline) {
                offline++;
            } else {
                active++;
            }

            const displayStatus = isOffline ? "OFFLINE" : (bin.status || "AVAILABLE").toUpperCase();
            const statusColor = isOffline ? "#999999" : getStatusColor(bin.status);

            const card = document.createElement('div');
            card.className = 'bin-card';
            card.onclick = () => startLiveUpdate(binId);
            
            card.innerHTML = `
                <div>
                    <h3 style="font-size: 0.95rem; color: #333;">Smart Bin #${binId.replace('bin_', '')}</h3>
                    <p id="list-status-${binId}" style="font-size: 0.8rem; color: ${statusColor};">
                        ${bin.barangay || 'Unassigned'} - ${displayStatus}
                    </p>
                </div>
                <span style="color: #ccc; font-weight: bold;">›</span>
            `;
            list.appendChild(card);
        }
        updateSummary(total, active, offline);
    } catch (err) {
        console.error("Load error:", err);
    }
}

function startLiveUpdate(binId) {
    toggleView('realtime');
    const statusBox = document.getElementById('active-bin-details');
    const removeBtn = document.getElementById('remove-bin-btn');

    activeBinId = binId;

    if (removeBtn) removeBtn.style.display = 'block';

    const fetchLatest = async () => {
        try {
            const { data: bin, error } = await supabase.from('bins').select('*').eq('id', binId).maybeSingle();
            if (error) throw error;

            if (bin) {
                const calculatedStatus = getDeviceOnlineStatus(bin.last_sync, bin.status);
                const isOffline = calculatedStatus === 'OFFLINE';
                
                const currentStatus = isOffline ? 'OFFLINE' : (bin.status || "available").toLowerCase();
                const color = isOffline ? '#999999' : (currentStatus === 'full' ? '#FF3B30' : '#99CC33');
                
                if (statusBox) {
                    statusBox.innerHTML = `
                        <p class="sync-text">Location: <span>${bin.lat || '0'}, ${bin.lng || '0'}</span></p>
                        <p class="sync-text">Barangay: <span>${bin.barangay || 'Unknown'}</span></p>
                        <p class="sync-text">Last Sync: <span>${bin.last_sync ? new Date(bin.last_sync).toLocaleTimeString() : 'Never'}</span></p>
                        <div class="connection-status" style="color: ${color}">
                            <div class="check-circle" style="background: ${color}">${isOffline ? '!' : '✓'}</div>
                            <span class="status-label">Live Status: ${currentStatus.toUpperCase()}</span>
                        </div>
                    `;
                }
            } else {
                toggleView('list');
            }
        } catch (err) {
            console.error("Live update error:", err);
        }
    };

    fetchLatest();
}

async function removeBin(binId, e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    let binIdToDelete = String(binId || '').trim();
    if (!binIdToDelete) return;

    const confirmDelete = confirm(`Are you sure you want to remove Smart Bin #${binIdToDelete.replace('bin_', '')}?`);
    if (!confirmDelete) return;

    try {
        if (!binIdToDelete.startsWith('bin_')) {
            const { data: matchingBin, error: lookupError } = await supabase
                .from('bins')
                .select('id')
                .in('id', [binIdToDelete, `bin_${binIdToDelete}`])
                .maybeSingle();
            if (lookupError) throw lookupError;
            if (matchingBin) binIdToDelete = matchingBin.id;
        }

        const { error } = await supabase.from('bins').delete().eq('id', binIdToDelete);
        if (error) throw error;

        alert("Bin removed successfully.");
        activeBinId = null;
        toggleView('list');
        await loadRegisteredBins();
    } catch (error) {
        console.error("Removal Error:", error);
        alert("Failed to remove bin: " + (error.message || "An error occurred while removing the bin."));
    }
}

function getStatusColor(status) {
    const s = String(status || "").toLowerCase();
    if (s === 'full') return '#FF3B30'; 
    if (s === 'available' || s === 'online') return '#99CC33'; 
    if (s === 'filling') return '#FFCC00'; 
    return '#999999'; 
}

function updateSummary(total, active, offline) {
    if (document.getElementById('total-count')) document.getElementById('total-count').innerText = total;
    if (document.getElementById('active-count')) document.getElementById('active-count').innerText = active;
    if (document.getElementById('offline-count')) document.getElementById('offline-count').innerText = offline;
}

function toggleView(view) {
    const listView = document.getElementById('device-list-view');
    const realtimeView = document.getElementById('realtime-status-view');
    const appContainer = document.getElementById('app-container');

    if (view === 'realtime') {
        if (listView) listView.style.display = 'none';
        if (realtimeView) realtimeView.style.display = 'block';
        if (appContainer) appContainer.classList.add('real-time-mode');
    } else {
        activeBinId = null;
        if (realtimeView) realtimeView.style.display = 'none';
        if (listView) listView.style.display = 'block';
        if (appContainer) appContainer.classList.remove('real-time-mode');
        loadRegisteredBins(); 
    }
}

function closeRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) modal.style.display = 'none';
    
    if (document.getElementById('new-bin-id')) document.getElementById('new-bin-id').value = '';
    if (document.getElementById('new-bin-barangay')) document.getElementById('new-bin-barangay').value = '';
    if (document.getElementById('new-bin-lat')) document.getElementById('new-bin-lat').value = '';
    if (document.getElementById('new-bin-lng')) document.getElementById('new-bin-lng').value = '';
}

async function processRegistration() {
    if (registrationInProgress) return;

    const rawId = document.getElementById('new-bin-id')?.value.trim();
    const barangay = document.getElementById('new-bin-barangay')?.value.trim();
    const lat = document.getElementById('new-bin-lat')?.value.trim();
    const lng = document.getElementById('new-bin-lng')?.value.trim();

    if (!rawId || !barangay || !lat || !lng) {
        alert("Please fill in all fields (Bin ID, Barangay, Latitude, and Longitude).");
        return;
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        alert("Latitude and longitude must be valid numbers.");
        return;
    }

    const newBinData = {
        id: rawId,
        barangay: barangay,
        status: "available",
        lat: latitude,
        lng: longitude,
        level: 0,
        volume: 0,
        last_sync: new Date().toISOString() // Dynamic current timestamp
    };

    const registerButton = document.querySelector('#register-modal .confirm-btn');
    registrationInProgress = true;
    if (registerButton) registerButton.disabled = true;

    try {
        const { error } = await supabase.from('bins').upsert([newBinData], { onConflict: 'id' });
        
        if (error) {
            console.error("Database Insert Error:", error);
            alert(`Database Error: ${error.message}`);
            return;
        }

        alert(`Smart Bin #${rawId} successfully registered!`);
        closeRegisterModal();
        await loadRegisteredBins();
    } catch (error) {
        console.error("Registration Error Details:", error);
        alert(`Unable to register the bin: ${error.message}`);
    } finally {
        registrationInProgress = false;
        if (registerButton) registerButton.disabled = false;
    }
}

// Global scope bindings
window.closeRegisterModal = closeRegisterModal;
window.processRegistration = processRegistration;
window.toggleView = toggleView;

// Supabase Realtime Subscription
supabase.channel('system-management-bins')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, () => {
        if (activeBinId) startLiveUpdate(activeBinId);
        else loadRegisteredBins();
    })
    .subscribe();