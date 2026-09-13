import { supabase } from './supabase-init.js';

let activeChannels = {};
let modalChannel = null;

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
        initNotifications(user); 
        
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

    if (openBtn && binModal) {
        openBtn.onclick = () => binModal.style.display = "flex";
    }

    if (cancelBtn && binModal) {
        cancelBtn.onclick = () => binModal.style.display = "none";
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
            const input = document.getElementById('binIdInput');
            const rawId = input?.value.trim();
            const { data: { user } } = await supabase.auth.getUser();
            
            if (!user) {
                alert("Please log in to connect a bin.");
                return;
            }

            if (!rawId) {
                alert("Please enter a Bin ID.");
                return;
            }

            confirmAdd.disabled = true;

            // Formulate search values for raw '01', prefixed 'bin_01', or exact input
            const cleanRaw = rawId.replace('bin_', '');
            const cleanPrefixed = `bin_${cleanRaw}`;

            try {
                // Check if the bin exists in public.bins
                const { data: binData, error: binError } = await supabase
                    .from('bins')
                    .select('id')
                    .or(`id.eq.${rawId},id.eq.${cleanRaw},id.eq.${cleanPrefixed}`)
                    .maybeSingle();

                if (binError) throw binError;
                
                if (!binData) {
                    alert("Invalid Bin ID. Ask the system administrator to register it first.");
                    return;
                }

                const targetBinId = binData.id;

                // Insert into user_connected_bins using the exact matched DB primary key
                const { error: insertError } = await supabase
                    .from('user_connected_bins')
                    .insert([{ user_id: user.id, bin_id: targetBinId }]);

                if (insertError) {
                    if (insertError.code === '23505') {
                        alert("This bin is already connected to your account.");
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
                alert(`Successfully connected to Smart Bin #${targetBinId.replace('bin_', '')}!`);

            } catch (error) {
                console.error("Add Bin Error:", error);
                alert(`Unable to add the bin: ${error.message || "Supabase request failed."}`);
            } finally {
                confirmAdd.disabled = false;
            }
        };
    }
});

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
    const container = document.getElementById('citizen-bins-container');
    const trigger = document.getElementById('openModalBtn');
    if (!container) return; 

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
    
    if (trigger && trigger.parentNode === container) {
        container.insertBefore(card, trigger);
    } else {
        container.appendChild(card);
    }
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
            <p style="font-size: 0.8rem; color: #666;">${data.barangay || 'Unassigned'}</p>
        </div>
        <div style="color: #ccc;">›</div>
    `;
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
        <p><strong>Barangay:</strong> ${data.barangay || 'N/A'}</p>
        <p><strong>Last Sync:</strong> ${data.last_sync ? new Date(data.last_sync).toLocaleTimeString() : 'Never'}</p>
        <button onclick="removeBin('${id}')" style="color:#FF3B30; background:none; border:1px solid #FF3B30; padding:10px; width:100%; margin-top:10px; border-radius:8px; cursor:pointer;">Disconnect</button>
    `;
}

window.removeBin = async function(id) {
    if (confirm(`Disconnect Smart Bin #${id.replace('bin_', '')}?`)) {
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