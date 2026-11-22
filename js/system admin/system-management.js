import { confirmAction, confirmDiscard } from '../action-confirmation.js';
import { supabase } from '../supabase-init.js';
let activeBinId = null;
let registrationInProgress = false;
let connectedCitizenLocationLabels = new Map();
let duplicateCheckTimer = null;
let duplicateCheckVersion = 0;
let registrationToastTimer = null;

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

    ['new-bin-id', 'new-bin-lat', 'new-bin-lng'].forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) input.addEventListener('input', scheduleDuplicateCheck);
    });

    // Attach click listener to cancel button
    const cancelBtn = document.querySelector('#register-modal .cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = async (e) => {
            e.preventDefault();
            const hasDraft = [...document.querySelectorAll('#register-modal input')].some(input => input.value);
            if (hasDraft && !await confirmDiscard('The bin registration details you entered will be lost.')) return;
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

function getBinInstallationLocation(bin) {
    const parts = [bin.street, bin.barangay]
        .map(value => String(value || '').trim())
        .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));

    return parts.join(', ') || 'Location not assigned';
}

function getConfirmedCitizenAddressLabel(profile) {
    if (profile?.role !== 'citizen' || profile.address_confirmed !== true) return null;

    const houseAndStreet = [profile.house_number, profile.street_name]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
    const parts = [
        houseAndStreet,
        profile.barangay,
        profile.city_municipality,
        profile.province
    ].map(value => String(value || '').trim())
        .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));

    return parts.join(', ') || null;
}

async function loadConnectedCitizenLocationLabels(binIds) {
    const labels = new Map();
    if (binIds.length === 0) return labels;

    const { data: connections, error: connectionError } = await supabase
        .from('user_connected_bins')
        .select('bin_id, user_id')
        .in('bin_id', binIds);
    if (connectionError) throw connectionError;

    const userIdsByBin = new Map();
    for (const connection of connections || []) {
        const userIds = userIdsByBin.get(connection.bin_id) || [];
        userIds.push(connection.user_id);
        userIdsByBin.set(connection.bin_id, userIds);
    }

    const uniqueUserIds = [...new Set(
        [...userIdsByBin.values()]
            .filter(userIds => userIds.length === 1)
            .map(userIds => userIds[0])
    )];
    if (uniqueUserIds.length === 0) return labels;

    const { data: profiles, error: profileError } = await supabase
        .from('users')
        .select('id, role, address_confirmed, house_number, street_name, barangay, city_municipality, province')
        .in('id', uniqueUserIds);
    if (profileError) throw profileError;

    const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
    for (const [binId, userIds] of userIdsByBin) {
        if (userIds.length !== 1) continue;

        const addressLabel = getConfirmedCitizenAddressLabel(profilesById.get(userIds[0]));
        if (addressLabel) labels.set(binId, addressLabel);
    }

    return labels;
}

function getBinLocationLabel(bin) {
    return connectedCitizenLocationLabels.get(bin.id) || getBinInstallationLocation(bin);
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
            connectedCitizenLocationLabels = new Map();
            updateSummary(0, 0, 0);
            return;
        }

        try {
            connectedCitizenLocationLabels = await loadConnectedCitizenLocationLabels(data.map(bin => bin.id));
        } catch (locationError) {
            connectedCitizenLocationLabels = new Map();
            console.error('Unable to load connected Citizen addresses:', locationError);
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
                        <span class="bin-location"></span> - ${displayStatus}
                    </p>
                </div>
                <span style="color: #ccc; font-weight: bold;">›</span>
            `;
            card.querySelector('.bin-location').textContent = getBinLocationLabel(bin);
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
                        <p class="sync-text">Installation location: <span class="bin-location"></span></p>
                        <p class="sync-text">Last Sync: <span>${bin.last_sync ? new Date(bin.last_sync).toLocaleTimeString() : 'Never'}</span></p>
                        <div class="connection-status" style="color: ${color}">
                            <div class="check-circle" style="background: ${color}">${isOffline ? '!' : '✓'}</div>
                            <span class="status-label">Live Status: ${currentStatus.toUpperCase()}</span>
                        </div>
                    `;
                    statusBox.querySelector('.bin-location').textContent = getBinLocationLabel(bin);
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

    if (!await confirmAction({
        title: `Remove Smart Bin #${binIdToDelete.replace('bin_', '')}?`,
        message: 'This removes the bin from BinSense and may affect users linked to it.',
        action: 'Remove',
        cancel: 'Cancel',
        tone: 'danger'
    })) return;

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

    clearTimeout(duplicateCheckTimer);
    duplicateCheckVersion++;
    ['new-bin-id', 'new-bin-lat', 'new-bin-lng'].forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) input.value = '';
    });
    clearRegistrationFieldErrors();
}

function setRegistrationFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(`${inputId}-error`);
    if (!input || !error) return;

    error.textContent = message;
    error.hidden = !message;
    if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', error.id);
    } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
    }
}

function clearRegistrationFieldErrors() {
    setRegistrationFieldError('new-bin-id', '');
    setRegistrationFieldError('new-bin-lat', '');
    setRegistrationFieldError('new-bin-lng', '');
}

function showRegistrationToast(message, isError = false) {
    const toast = document.getElementById('register-toast');
    if (!toast) return;

    clearTimeout(registrationToastTimer);
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.hidden = false;
    registrationToastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 4000);
}

function getRegistrationValues() {
    return {
        rawId: document.getElementById('new-bin-id')?.value.trim() || '',
        lat: document.getElementById('new-bin-lat')?.value.trim() || '',
        lng: document.getElementById('new-bin-lng')?.value.trim() || ''
    };
}

async function findExistingBinData(rawId, lat, lng) {
    const binNumber = rawId.replace(/^bin_/, '');
    const latitude = Number(lat);
    const longitude = Number(lng);
    const hasValidCoordinates = lat !== '' && lng !== '' &&
        Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

    if (!binNumber && !hasValidCoordinates) {
        return { duplicateId: false, duplicateCoordinates: false };
    }

    const idCandidates = [binNumber, `bin_${binNumber}`];
    const idLookup = binNumber
        ? supabase.from('bins').select('id').in('id', idCandidates).limit(1)
        : Promise.resolve({ data: [], error: null });
    const coordinateLookup = hasValidCoordinates
        ? supabase.from('bins').select('id').eq('lat', latitude).eq('lng', longitude).limit(1)
        : Promise.resolve({ data: [], error: null });
    const [idResult, coordinateResult] = await Promise.all([idLookup, coordinateLookup]);
    if (idResult.error) throw idResult.error;
    if (coordinateResult.error) throw coordinateResult.error;

    return {
        duplicateId: Boolean(idResult.data?.length),
        duplicateCoordinates: Boolean(coordinateResult.data?.length)
    };
}

function showDuplicateErrors(duplicateId, duplicateCoordinates) {
    setRegistrationFieldError('new-bin-id', duplicateId ? 'This Bin ID exists.' : '');
    const coordinateMessage = duplicateCoordinates ? 'Coordinates exist.' : '';
    setRegistrationFieldError('new-bin-lat', coordinateMessage);
    setRegistrationFieldError('new-bin-lng', coordinateMessage);
}

function scheduleDuplicateCheck() {
    clearTimeout(duplicateCheckTimer);
    const version = ++duplicateCheckVersion;
    clearRegistrationFieldErrors();

    duplicateCheckTimer = setTimeout(async () => {
        const { rawId, lat, lng } = getRegistrationValues();
        try {
            const { duplicateId, duplicateCoordinates } = await findExistingBinData(rawId, lat, lng);
            if (version === duplicateCheckVersion) {
                showDuplicateErrors(duplicateId, duplicateCoordinates);
            }
        } catch (error) {
            console.error('Unable to check for existing bin data:', error);
        }
    }, 250);
}

async function processRegistration() {
    if (registrationInProgress) return;

    const { rawId, lat, lng } = getRegistrationValues();

    clearRegistrationFieldErrors();
    if (!rawId || !lat || !lng) {
        if (!rawId) setRegistrationFieldError('new-bin-id', 'Enter a Bin ID.');
        if (!lat) setRegistrationFieldError('new-bin-lat', 'Enter a latitude.');
        if (!lng) setRegistrationFieldError('new-bin-lng', 'Enter a longitude.');
        document.querySelector('#register-modal [aria-invalid="true"]')?.focus();
        return;
    }

    const binNumber = rawId.replace(/^bin_/, '');
    if (!binNumber) {
        setRegistrationFieldError('new-bin-id', 'Enter a valid Bin ID.');
        document.getElementById('new-bin-id')?.focus();
        return;
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const invalidLatitude = !Number.isFinite(latitude) || Math.abs(latitude) > 90;
    const invalidLongitude = !Number.isFinite(longitude) || Math.abs(longitude) > 180;
    if (invalidLatitude || invalidLongitude) {
        if (invalidLatitude) setRegistrationFieldError('new-bin-lat', 'Enter a latitude from -90 to 90.');
        if (invalidLongitude) setRegistrationFieldError('new-bin-lng', 'Enter a longitude from -180 to 180.');
        document.querySelector('#register-modal [aria-invalid="true"]')?.focus();
        return;
    }

    const newBinData = {
        id: rawId,
        status: "available",
        lat: latitude,
        lng: longitude,
        level: 0,
        volume: 0
    };

    const registerButton = document.querySelector('#register-modal .confirm-btn');
    registrationInProgress = true;
    if (registerButton) registerButton.disabled = true;

    try {
        const { duplicateId, duplicateCoordinates } = await findExistingBinData(rawId, lat, lng);
        if (duplicateId || duplicateCoordinates) {
            showDuplicateErrors(duplicateId, duplicateCoordinates);
            return;
        }

        const { error } = await supabase.from('bins').insert([newBinData]);
        if (error?.code === '23505') {
            setRegistrationFieldError('new-bin-id', 'This Bin ID exists.');
            return;
        }

        if (error) {
            console.error("Database Save Error:", error);
            showRegistrationToast(`Database Error: ${error.message}`, true);
            return;
        }

        showRegistrationToast(`Smart Bin #${rawId} successfully registered.`);
        closeRegisterModal();
        await loadRegisteredBins();
    } catch (error) {
        console.error("Registration Error Details:", error);
        showRegistrationToast(`Unable to register the bin: ${error.message}`, true);
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