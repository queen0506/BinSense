import { supabase } from './supabase-init.js';

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
   DISCONNECT CONFIRM POP-UP
============================ */
function showDisconnectConfirm(binNumber) {
    return new Promise((resolve) => {
        const modal = document.getElementById('bin-confirm-modal');
        const chip = document.getElementById('bin-confirm-chip');
        const okBtn = document.getElementById('bin-confirm-ok');
        const cancelBtn = document.getElementById('bin-confirm-cancel');

        chip.textContent = `Smart Bin #${binNumber}`;
        modal.classList.add('show');

        const finish = (result) => {
            modal.classList.remove('show');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => finish(true);
        const onCancel = () => finish(false);
        const onOverlay = (e) => { if (e.target === modal) finish(false); };
        const onKey = (e) => { if (e.key === 'Escape') finish(false); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);
    });
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
        loadUserProfile(user); 
        initNotifications(user);
        initCalendar(user);
        
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
                    showBinNotice("Invalid Bin ID", "Ask the system administrator to register it first.");
                    return;
                }

                const targetBinId = binData.id;

                // Insert into user_connected_bins using the exact matched DB primary key
                const { error: insertError } = await supabase
                    .from('user_connected_bins')
                    .insert([{ user_id: user.id, bin_id: targetBinId }]);

                if (insertError) {
                    if (insertError.code === '23505') {
                        showBinNotice("Already Connected", "This bin is already connected to your account.");
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
                showBinSuccess(targetBinId.replace('bin_', ''));

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
    if (await showDisconnectConfirm(id.replace('bin_', ''))) {
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