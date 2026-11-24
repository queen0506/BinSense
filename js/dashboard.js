import { confirmAction, confirmDiscard } from './action-confirmation.js';
import { supabase } from './supabase-init.js';
import { EAST_BAJAC_BAJAC, detectCurrentLocation, saveCitizenAddress } from './citizen-address.js';

/* ============================
   BIN CONNECTED SUCCESS POP-UP
============================ */
function showBinSuccess(binNumber) {
    const modal = document.getElementById('bin-success-modal');
    const chip = document.getElementById('bin-success-chip');
    const btn = document.getElementById('bin-success-close');
    if (!modal) return;

    chip.textContent = `Smart Bin #${binNumber}`;
    modal.classList.add('show');

    const close = () => {
        modal.classList.remove('show');
        btn.removeEventListener('click', close);
    };
    btn.addEventListener('click', close);
}
/* ============================
   NOTICE POP-UP
============================ */
function showBinNotice(title, message) {
    const modal = document.getElementById('bin-notice-modal');
    const titleEl = document.getElementById('bin-notice-title');
    const textEl = document.getElementById('bin-notice-text');
    const btn = document.getElementById('bin-notice-close');
    if (!modal) return;

    titleEl.textContent = title;
    textEl.textContent = message;
    modal.classList.add('show');

    const close = () => {
        modal.classList.remove('show');
        btn.removeEventListener('click', close);
    };
    btn.addEventListener('click', close);
}

function setCitizenBinIdError(input, message) {
    const error = document.getElementById('binIdError');
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

let activeChannels = {};
let modalChannel = null;
let currentCitizenAddressLabel = 'Location not assigned';

function getConfirmedCitizenAddressLabel(profile) {
    if (profile?.address_confirmed !== true) return 'Location not assigned';

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

    return parts.join(', ') || 'Location not assigned';
}

function refreshCitizenBinLocationLabels() {
    document.querySelectorAll('.citizen-bin-card .bin-location, #detailsBody .bin-location')
        .forEach(element => {
            element.textContent = currentCitizenAddressLabel;
        });
}

/* ============================
   REAL-TIME NOTIFICATION SYSTEM
============================ */
async function initNotifications(user) {
    const list = document.getElementById('notificationList');
    const btn = document.getElementById('notificationBtn');
    const panel = document.getElementById('notificationPanel');
    const closeBtn = document.getElementById('closeNotificationBtn');
    const clearBtn = document.getElementById('clearNotifications');

    // UI Click Listeners with Null Checks
    if (btn && panel) {
        btn.onclick = (e) => {
            e.stopPropagation();
            panel.classList.toggle('active');
        };
    }
    
    if (closeBtn && panel) {
        closeBtn.onclick = () => panel.classList.remove('active');
    }

    if (clearBtn && list) {
        clearBtn.onclick = () => {
            // Save current time to suppress notifications on reload
            const now = Date.now();
            localStorage.setItem(`cleared_at_${user.id}`, now);
            
            list.innerHTML = '<p class="empty-notification-message">Stay tuned for collection updates!</p>';
            updateBadge(0);
        };
    }

    // Fetch user profile from Supabase
    const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    const userBarangay = userData?.barangay || userData?.profile?.barangay;
    if (list) list.innerHTML = '<p class="empty-notification-message">Stay tuned for other updates!</p>';

    // Load initial Notifications (Global & Local Barangay)
    loadNotifications('Global', user.id);

    if (!userBarangay) {
        addNotificationUI("Location Missing", "Set your Barangay in profile.", "warning", "📍");
    } else {
        loadNotifications(userBarangay, user.id);
    }

    // Subscribe to new realtime notifications
    supabase
        .channel('public:notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
            const data = payload.new;
            if (data.barangay === 'Global' || data.barangay === userBarangay) {
                const clearedAt = parseInt(localStorage.getItem(`cleared_at_${user.id}`)) || 0;
                const createdAt = new Date(data.created_at || Date.now()).getTime();

                if (createdAt > clearedAt) {
                    const type = data.type === 'cancellation' ? 'alert' : 'warning';
                    const icon = data.type === 'cancellation' ? '✕' : '📅';
                    addNotificationUI(data.title, formatNotificationMessage(data), type, icon);
                }
            }
        })
        .subscribe();
}

async function loadNotifications(barangay, userId) {
    const clearedAt = parseInt(localStorage.getItem(`cleared_at_${userId}`)) || 0;

    const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('barangay', barangay)
        .order('created_at', { ascending: false })
        .limit(barangay === 'Global' ? 5 : 10);

    if (notifications && notifications.length > 0) {
        notifications.reverse().forEach(data => {
            const createdAt = new Date(data.created_at || Date.now()).getTime();
            if (createdAt <= clearedAt) return;

            const type = data.type === 'cancellation' ? 'alert' : 'warning';
            const icon = data.type === 'cancellation' ? '✕' : '📅';
            addNotificationUI(data.title, formatNotificationMessage(data), type, icon);
        });
    }
}

function formatNotificationMessage(notification) {
    if (notification.type === 'collection' && notification.time && !notification.message.includes(' at ')) {
        return `${notification.message} at ${notification.time}`;
    }
    return notification.message;
}

function addNotificationUI(title, message, type, icon) {
    const list = document.getElementById('notificationList');
    if (!list) return;

    const emptyMsg = list.querySelector('.empty-notification-message');
    if (emptyMsg) emptyMsg.remove();

    const existing = Array.from(list.querySelectorAll('.notification-message'));
    if (existing.some(p => p.innerText === message)) return;

    const item = document.createElement('div');
    item.className = 'notification-item unread';
    item.innerHTML = `
        <div class="notification-icon-circle ${type}">${icon}</div>
        <div class="notification-content">
            <span class="notification-title">${title}</span>
            <p class="notification-message">${message}</p>
        </div>
    `;
    list.prepend(item);
    updateBadge(list.querySelectorAll('.notification-item').length);
}

function updateBadge(count) {
    const btn = document.getElementById('notificationBtn');
    if (!btn) return;

    let badge = btn.querySelector('.notification-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notification-badge';
            btn.appendChild(badge);
        }
        badge.innerText = count;
    } else if (badge) {
        badge.remove();
    }
}

/* ============================
   SMART BIN LOGIC
============================ */
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth session on load
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        loadUserProfile(user); 
        initNotifications(user);
        initCalendar(user);
        await initCitizenAddressSetup(user);
        
        // Only load bins if container exists (Dashboard page)
        const binContainer = document.getElementById('citizen-bins-container');
        if (binContainer) {
            const { data: connectedBins } = await supabase
                .from('user_connected_bins')
                .select('bin_id')
                .eq('user_id', user.id);

            if (connectedBins) {
                for (const row of connectedBins) {
                    if (!document.getElementById(`card-${row.bin_id}`)) {
                        await addBinCardToUI(row.bin_id);
                    }
                }
            }
        }
    }

    /* ============================
       DAILY REMINDER LOGIC
    ============================ */
    function checkDailyReminder() {
        const reminderModal = document.getElementById('dailyReminderModal');
        const closeBtn = document.getElementById('closeReminderBtn');
        
        const today = new Date().toISOString().split('T')[0];
        const lastShownDate = localStorage.getItem('lastReminderDate');

        if (lastShownDate !== today && reminderModal) {
            reminderModal.style.display = "flex";
        }

        if (closeBtn && reminderModal) {
            closeBtn.onclick = () => {
                reminderModal.style.display = "none";
                localStorage.setItem('lastReminderDate', today);
            };
        }
    }

    checkDailyReminder();

    const openBtn = document.getElementById('openModalBtn');
    const binModal = document.getElementById('binModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const binIdInput = document.getElementById('binIdInput');

    if (binIdInput) {
        binIdInput.addEventListener('input', () => setCitizenBinIdError(binIdInput, ''));
    }

    if (openBtn && binModal) {
        openBtn.onclick = () => {
            setCitizenBinIdError(binIdInput, '');
            binModal.style.display = "flex";
        };
    }

    if (cancelBtn && binModal) {
        cancelBtn.onclick = async () => {
            const input = document.getElementById('binIdInput');
            if (input.value && !await confirmDiscard('The Bin ID you entered will be cleared.')) return;
            input.value = '';
            setCitizenBinIdError(input, '');
            binModal.style.display = 'none';
        };
    }

    const closeDetails = document.getElementById('closeDetailsBtn');
    const detailsModal = document.getElementById('detailsModal');
    if (closeDetails && detailsModal) {
        closeDetails.onclick = () => {
            detailsModal.style.display = "none";
            if (modalChannel) {
                supabase.removeChannel(modalChannel);
                modalChannel = null;
            }
        };
    }

    const confirmAdd = document.getElementById('confirmAddBtn');
    if (confirmAdd) {
        confirmAdd.onclick = async () => {
            const input = binIdInput;
            const rawId = input?.value.trim();
            if (!rawId) {
                setCitizenBinIdError(input, 'Enter a Bin ID.');
                input?.focus();
                return;
            }

            const cleanRaw = rawId.replace(/^bin_/i, '');
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(rawId) || !/[A-Za-z0-9]/.test(cleanRaw)) {
                setCitizenBinIdError(input, 'Use a valid Bin ID (letters, numbers, hyphens, or underscores only).');
                input?.focus();
                return;
            }

            confirmAdd.disabled = true;

            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                if (authError) throw authError;
                if (!user) {
                    showBinNotice("Sign In Required", "Please log in to connect a bin.");
                    return;
                }

                const idCandidates = [...new Set([rawId, cleanRaw, `bin_${cleanRaw}`])];
                // Check if the bin exists in public.bins
                const { data: matchingBins, error: binError } = await supabase
                    .from('bins')
                    .select('id')
                    .in('id', idCandidates)
                    .limit(2);

                if (binError) throw binError;
                if (!matchingBins?.length) {
                    showBinNotice("Invalid Bin ID", "Ask the system administrator to register it first.");
                    return;
                }
                if (matchingBins.length > 1) {
                    showBinNotice("Ambiguous Bin ID", "This Bin ID matches more than one registered bin. Contact the system administrator.");
                    return;
                }

                const targetBinId = matchingBins[0].id;

                // Insert into user_connected_bins using the exact matched DB primary key
                const { error: insertError } = await supabase
                    .from('user_connected_bins')
                    .insert([{ user_id: user.id, bin_id: targetBinId }]);

                if (insertError) {
                    if (insertError.code === '23505') {
                        showBinNotice("Bin Already Linked", "This smart bin is already linked to an account. If it should be transferred to you, contact the system administrator.");
                        setCitizenBinIdError(input, 'This ID is already linked to an account');
                        input?.focus();                    
                    } else {
                        throw insertError;
                    }
                    return;
                }

                if (!document.getElementById(`card-${targetBinId}`)) {
                    await addBinCardToUI(targetBinId);
                }
                
                if (binModal) binModal.style.display = "none";
                if (input) input.value = '';
                setCitizenBinIdError(input, '');
                showBinSuccess(targetBinId.replace(/^bin_/i, ''));

            } catch (error) {
                console.error("Add Bin Error:", error);
                alert(`Unable to add the bin: ${error.message || "Supabase request failed."}`);
            } finally {
                confirmAdd.disabled = false;
            }
        };
    }
});

/* ============================
   LOAD USER PROFILE (Name)
============================ */
async function loadUserProfile(user) {
    const nameDisplay = document.getElementById('userNameDisplay');
    if (!nameDisplay) return;

    try {
        const { data: profile, error } = await supabase
            .from('users')
            .select('name')
            .eq('id', user.id)
            .maybeSingle();

        if (error) throw error;

        if (profile && profile.name) {

            const firstName = profile.name.split(' ')[0]; 
            nameDisplay.innerText = firstName;
        } else {
            const emailName = user.email.split('@')[0];
            nameDisplay.innerText = emailName;
        }

    } catch (error) {
        console.error("Error loading profile:", error);
        nameDisplay.innerText = "User"; // Fallback
    }
}

async function initCitizenAddressSetup(user) {
    const role = String(localStorage.getItem('userRole') || '').toLowerCase();
    if (role && role !== 'citizen') return;

    const modal = document.getElementById('citizen-location-modal');
    const status = document.getElementById('location-modal-status');
    const preview = document.getElementById('location-address-preview');
    const currentButton = document.getElementById('location-current-btn');
    const manualButton = document.getElementById('location-manual-btn');
    const confirmButton = document.getElementById('location-confirm-btn');
    const serviceAreaConfirmation = document.getElementById('location-service-area-confirm');
    const addressFieldIds = {
        houseNumber: 'location-house',
        streetName: 'location-street',
        cityMunicipality: 'location-city',
        province: 'location-province',
        postalCode: 'location-postal'
    };
    const addressFields = Object.fromEntries(
        Object.entries(addressFieldIds).map(([field, id]) => [field, document.getElementById(id)])
    );
    if (!modal || !status || !preview || !currentButton || !manualButton || !confirmButton ||
        !serviceAreaConfirmation || Object.values(addressFields).some(field => !field)) {
        console.error('Citizen location setup cannot initialize: required modal elements are missing.');
        return;
    }

    let profile;
    let error;
    try {
        const result = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
        profile = result.data;
        error = result.error;
    } catch (queryError) {
        error = queryError;
    }

    if (error) {
        modal.classList.add('show');
        status.textContent = 'Could not load your saved address. Refresh and try again.';
        currentButton.disabled = true;
        manualButton.disabled = true;
        confirmButton.disabled = true;
        console.error('Citizen address profile query failed:', error);
        return;
    }

    currentCitizenAddressLabel = getConfirmedCitizenAddressLabel(profile);

    if (profile?.address_confirmed === true) return;

    addressFields.houseNumber.value = profile?.house_number || '';
    addressFields.streetName.value = profile?.street_name || '';
    addressFields.cityMunicipality.value = profile?.city_municipality || '';
    addressFields.province.value = profile?.province || '';
    addressFields.postalCode.value = profile?.postal_code || '';

    modal.classList.add('show');
    status.textContent = '';
    let activeDetection = 0;
    const detectedAddressValues = {};

    function showAddressPreview(address) {
        preview.hidden = false;
        currentButton.hidden = false;
        currentButton.textContent = 'Retry Location';
        currentButton.classList.remove('location-primary-btn');
        currentButton.classList.add('location-secondary-btn', 'location-retry-btn');
        manualButton.hidden = true;
        confirmButton.hidden = false;
        if (address) {
            for (const [field, value] of Object.entries(address)) {
                if (field === 'barangay' || !value || !addressFields[field]) continue;
                const currentValue = addressFields[field].value.trim();
                const previousDetectedValue = detectedAddressValues[field];
                if (!currentValue || currentValue === previousDetectedValue) {
                    addressFields[field].value = value;
                    detectedAddressValues[field] = value;
                }
            }
        }
    }

    currentButton.addEventListener('click', () => {
        const detectionId = ++activeDetection;
        currentButton.disabled = true;
        status.textContent = 'Detecting your location...';
        detectCurrentLocation(state => {
            if (detectionId !== activeDetection) return;
            if (state.type === 'request' || state.type === 'detecting') {
                status.textContent = state.message;
                return;
            }

            currentButton.disabled = false;
            if (state.type === 'detected') {
                showAddressPreview(state.address);
                const hasMissingDetails = Object.values(addressFields).some(field => !field.value.trim());
                if (state.mayBeOutsideServiceArea) {
                    status.textContent = hasMissingDetails
                        ? 'Detected location may be outside East Bajac-Bajac. Complete the missing address details.'
                        : 'Detected location may be outside East Bajac-Bajac. Review your address.';
                } else {
                    status.textContent = hasMissingDetails
                        ? 'Complete the missing address details.'
                        : 'Location detected. Review your address.';
                }
            } else {
                status.textContent = state.message;
                showAddressPreview();
            }
        }, { serviceArea: EAST_BAJAC_BAJAC });
    });

    manualButton.addEventListener('click', () => {
        activeDetection += 1;
        currentButton.disabled = false;
        showAddressPreview();
        status.textContent = 'Complete your address manually.';
        if (Object.values(addressFields).some(field => !field.value.trim())) {
            status.textContent += ' Please complete the missing address details.';
        }
    });

    confirmButton.addEventListener('click', async () => {
        const address = {
            houseNumber: addressFields.houseNumber.value.trim() || null,
            streetName: addressFields.streetName.value.trim() || null,
            barangay: EAST_BAJAC_BAJAC,
            cityMunicipality: addressFields.cityMunicipality.value.trim() || null,
            province: addressFields.province.value.trim() || null,
            postalCode: addressFields.postalCode.value.trim() || null
        };
        if (!address.cityMunicipality || !address.province) {
            status.textContent = 'Please complete the missing address details.';
            (addressFields.cityMunicipality.value.trim()
                ? addressFields.province
                : addressFields.cityMunicipality).focus();
            return;
        }
        if (!serviceAreaConfirmation.checked) {
            status.textContent = 'Confirm your address is in East Bajac-Bajac.';
            serviceAreaConfirmation.focus();
            return;
        }

        confirmButton.disabled = true;
        confirmButton.textContent = 'Saving...';
        status.textContent = 'Saving address...';
        const { error: saveError } = await saveCitizenAddress(user.id, address, true);
        if (saveError) {
            console.error('Address save error:', saveError);
            status.textContent = 'Could not save. Try again.';
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm Address';
            return;
        }
        currentCitizenAddressLabel = getConfirmedCitizenAddressLabel({
            ...address,
            address_confirmed: true
        });
        refreshCitizenBinLocationLabels();
        status.textContent = 'Address confirmed. GPS not verified.';
        confirmButton.textContent = 'Address Saved';
        setTimeout(() => modal.classList.remove('show'), 900);
    });
}

function getDeviceOnlineStatus(lastSyncTimestamp, rawStatus) {
    if (String(rawStatus).toLowerCase() === "offline") return 'OFFLINE';
    if (!lastSyncTimestamp) return 'OFFLINE';

    const lastSyncTime = new Date(lastSyncTimestamp).getTime();
    if (isNaN(lastSyncTime)) return 'OFFLINE';

    const currentTime = Date.now();
    const diff = currentTime - lastSyncTime;

    if (diff < 0 && Math.abs(diff) < 300000) return 'ACTIVE';

    const OFFLINE_THRESHOLD = 60000; // 60 seconds
    return (diff < OFFLINE_THRESHOLD) ? 'ACTIVE' : 'OFFLINE';
}

async function addBinCardToUI(id) {
    // 1. Targetin ang wrapper imbis na ang buong carousel container
    const wrapper = document.querySelector('.bin-card-wrapper');
    if (!wrapper) return; 

    // 2. Hanapin at tanggalin ang "empty-card" kapag may na-add na bin
    const emptyCard = wrapper.querySelector('.empty-card');
    if (emptyCard) {
        emptyCard.remove();
    }

    const card = document.createElement('div');
    card.className = 'citizen-bin-card';
    card.id = `card-${id}`;

    // Fetch initial bin state
    const { data: initialBin } = await supabase
        .from('bins')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (initialBin) {
        updateCardUI(card, id, initialBin);
    }

    // Unsubscribe previous channel if existing
    if (activeChannels[id]) {
        supabase.removeChannel(activeChannels[id]);
    }

    // Subscribe to realtime bin changes
    activeChannels[id] = supabase
        .channel(`bin-card-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bins', filter: `id=eq.${id}` }, (payload) => {
            const binData = payload.new;
            if (binData) {
                updateCardUI(card, id, binData);
                if (binData.status?.toLowerCase() === 'full') {
                    addNotificationUI("Bin Full", `Bin #${id.replace('bin_', '')} is full.`, "alert", "!");
                }
            }
        })
        .subscribe();

    card.onclick = () => showDetails(id);
    
    // 3. I-append ang bagong card diretso sa loob ng wrapper
    wrapper.appendChild(card);
}

function updateCardUI(cardElement, id, data) {
    const dynamicStatus = getDeviceOnlineStatus(data.last_sync, data.status);
    const isOffline = dynamicStatus === 'OFFLINE';
    
    const displayStatus = isOffline ? "OFFLINE" : String(data.status || "available").toLowerCase();
    const color = isOffline ? "#999999" : (displayStatus === 'full') ? "#FF3B30" : (displayStatus === 'filling') ? "#FFCC00" : "#99CC33";

    cardElement.innerHTML = `
        <div class="bin-info">
            <h3 style="margin:0;">Bin #${id.replace('bin_', '')}</h3>
            <p style="color: ${color}; font-weight: bold;">● ${displayStatus.toUpperCase()}</p>
            <p class="bin-location" style="font-size: 0.8rem; color: #666;"></p>
        </div>
        <div style="color: #ccc;">›</div>
    `;
    cardElement.querySelector('.bin-location').textContent = currentCitizenAddressLabel;
}

async function showDetails(id) {
    const detailsBody = document.getElementById('detailsBody');
    const detailsModal = document.getElementById('detailsModal');
    if (!detailsBody || !detailsModal) return;

    // Fetch details
    const { data: binData } = await supabase
        .from('bins')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (binData) {
        renderDetailsModal(detailsBody, id, binData);
    }

    // Unsubscribe previous modal listener if open
    if (modalChannel) supabase.removeChannel(modalChannel);

    // Listen live for modal updates
    modalChannel = supabase
        .channel(`bin-details-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bins', filter: `id=eq.${id}` }, (payload) => {
            if (payload.new) renderDetailsModal(detailsBody, id, payload.new);
        })
        .subscribe();

    detailsModal.style.display = "flex";
}

function renderDetailsModal(container, id, data) {
    const dynamicStatus = getDeviceOnlineStatus(data.last_sync, data.status);
    const isOffline = dynamicStatus === 'OFFLINE';

    const displayStatus = isOffline ? "OFFLINE" : String(data.status || "available").toLowerCase();
    const color = isOffline ? "#999999" : (displayStatus === 'full') ? "#FF3B30" : (displayStatus === 'filling') ? "#FFCC00" : "#99CC33";

    container.innerHTML = `
        <p><strong>ID:</strong> ${id.replace('bin_', '')}</p>
        <p><strong>Status:</strong> <span style="color:${color}">${displayStatus.toUpperCase()}</span></p>
        <p><strong>Location:</strong> <span class="bin-location"></span></p>
        <p><strong>Last Sync:</strong> ${data.last_sync ? new Date(data.last_sync).toLocaleTimeString() : 'Never'}</p>
        <button onclick="removeBin('${id}')" style="color:#FF3B30; background:none; border:1px solid #FF3B30; padding:10px; width:100%; margin-top:10px; border-radius:8px; cursor:pointer;">Disconnect</button>
    `;
    container.querySelector('.bin-location').textContent = currentCitizenAddressLabel;
}

window.removeBin = async function(id) {
    if (await confirmAction({
        title: `Disconnect Smart Bin #${id.replace('bin_', '')}?`,
        message: 'The bin will be removed from your dashboard. You can reconnect it later with its Bin ID.',
        action: 'Disconnect Bin',
        cancel: 'Keep Connected'
    })) {
        if (activeChannels[id]) {
            supabase.removeChannel(activeChannels[id]);
            delete activeChannels[id];
        }

        const card = document.getElementById(`card-${id}`);
        if (card) card.remove();
        
        const detailsModal = document.getElementById('detailsModal');
        if (detailsModal) detailsModal.style.display = "none";
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { error } = await supabase
                .from('user_connected_bins')
                .delete()
                .eq('user_id', user.id)
                .eq('bin_id', id);

            if (error) {
                console.error("Disconnect Error:", error);
                alert("Failed to disconnect bin: " + error.message);
            }
        }
    }
};

/* ============================
   WASTE COLLECTION CALENDAR
============================ */
let userSchedules = [];
let calendarCurrentDate = new Date();
let currentUserBarangay = 'Global';

async function initCalendar(user) {
    const { data: userData } = await supabase
        .from('users')
        .select('barangay')
        .eq('id', user.id)
        .maybeSingle();
        
    currentUserBarangay = userData?.barangay || 'Global';

    // 2. Setup Dropdowns
    const yearSelect = document.getElementById('calYearSelect');
    const monthSelect = document.getElementById('calMonthSelect');
    const thisYear = new Date().getFullYear();
    
    if (yearSelect) {
        yearSelect.innerHTML = '';
        [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === thisYear) opt.selected = true;
            yearSelect.appendChild(opt);
        });
        yearSelect.onchange = (e) => {
            calendarCurrentDate.setFullYear(parseInt(e.target.value));
            renderCalendar();
        };
    }

    if (monthSelect) {
        monthSelect.value = calendarCurrentDate.getMonth();
        monthSelect.onchange = (e) => {
            calendarCurrentDate.setMonth(parseInt(e.target.value));
            renderCalendar();
        };
    }

    // 3. Navigation Buttons (< / >)
    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');

    if (prevBtn) {
        prevBtn.onclick = () => {
            calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
            if (monthSelect) monthSelect.value = calendarCurrentDate.getMonth();
            if (yearSelect) yearSelect.value = calendarCurrentDate.getFullYear();
            renderCalendar();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
            if (monthSelect) monthSelect.value = calendarCurrentDate.getMonth();
            if (yearSelect) yearSelect.value = calendarCurrentDate.getFullYear();
            renderCalendar();
        };
    }

    // 4. Fetch Data and Initial Render
    await fetchSchedules(currentUserBarangay);
    renderCalendar();

    // 5. Realtime Updates 
    supabase.channel('calendar-updates')
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'notifications',
            filter: 'type=eq.collection'
        }, async () => {
            console.log("Bagong schedule na-detect! Nag-a-update ng calendar...");
            await fetchSchedules(currentUserBarangay);
            renderCalendar();
        })
        .subscribe();
}

async function fetchSchedules(userBarangay) {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('type', 'collection');

    if (error) {
        console.error("Error fetching schedules:", error);
        return;
    }

    const cleanUserBrgy = (userBarangay || '').toLowerCase().replace(/brgy\.?|barangay/g, '').trim();

    userSchedules = (data || []).filter(n => {
        if (!n.barangay || n.barangay === 'Global') return true;
        if (!cleanUserBrgy || cleanUserBrgy === 'global') return true;
        
        const cleanSchedBrgy = n.barangay.toLowerCase().replace(/brgy\.?|barangay/g, '').trim();
        return cleanSchedBrgy.includes(cleanUserBrgy) || cleanUserBrgy.includes(cleanSchedBrgy);
    });
}

function renderCalendar() {
    const datesContainer = document.getElementById('calDates');
    if (!datesContainer) return;

    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();
    
    datesContainer.innerHTML = ''; 

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('span');
        blank.className = 'cal-date cal-empty';
        datesContainer.appendChild(blank);
    }

    // Generate days
    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        
        const schedulesForDay = userSchedules.filter(s => {
            if (!s.date) return false;
            return String(s.date).trim() === dateStr;
        });

        const hasSchedule = schedulesForDay.length > 0;
        
        const span = document.createElement('span');
        span.className = 'cal-date';
        span.innerText = i;

        if (hasSchedule) {
            span.classList.add('has-schedule');
            span.onclick = () => showScheduleDetails(dateStr, schedulesForDay);
        }

        if (dateStr === todayStr) {
            span.classList.add('active');
        }
        
        datesContainer.appendChild(span);
    }
}

function showScheduleDetails(date, schedules) {
    const detailsBody = document.getElementById('detailsBody');
    const detailsModal = document.getElementById('detailsModal');
    
    if (!detailsBody || !detailsModal) return;

    const title = detailsModal.querySelector('h3');
    if(title) title.innerText = `Collection Schedule`;

    const dateParts = date.split('-');
    const displayDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    let html = `<p style="text-align:center; font-weight:bold; margin-bottom:15px;">${displayDate}</p>`;
    
    schedules.forEach(s => {
        const statusColor = s.collection_status === 'Done' ? '#4caf50' : (s.collection_status === 'Cancelled' ? '#f44336' : '#ff9800');
        
        let timeDisplay = 'TBA';
        if (s.time) {
            const timeParts = s.time.split(':');
            const hour = parseInt(timeParts[0]);
            const minute = timeParts[1];
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            timeDisplay = `${displayHour}:${minute} ${ampm}`;
        }

        html += `
            <div style="background:#f6faf2; padding:15px; border-radius:12px; margin-bottom:10px; border:1px solid #e8f5e9; text-align: left;">
                <p style="margin: 0 0 5px 0;"><strong>Barangay:</strong> ${s.barangay}</p>
                <p style="margin: 0 0 5px 0;"><strong>Time:</strong> ${timeDisplay}</p>
                <p style="margin: 0 0 5px 0;"><strong>Type:</strong> ${s.scheduleType || 'General'}</p>
                <p style="margin: 0;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight:bold;">${s.collection_status || 'Scheduled'}</span></p>
            </div>
        `;
    });

    detailsBody.innerHTML = html;
    detailsModal.style.display = "flex";
}