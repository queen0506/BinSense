import { supabase } from './supabase-init.js';

let activeChannels = {}; // For bins (if needed)

/* ============================
   REAL-TIME NOTIFICATION SYSTEM (Matches Dashboard)
============================ */
async function initNotifications(user) {
    const list = document.getElementById('notificationList');
    const btn = document.getElementById('notificationBtn');
    const panel = document.getElementById('notificationPanel');
    const closeBtn = document.getElementById('closeNotificationBtn');
    // Use 'clearAllBtn' to match the HTML we fixed earlier
    const clearBtn = document.getElementById('clearAllBtn'); 

    // UI Click Listeners
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
            const now = Date.now();
            localStorage.setItem(`cleared_at_${user.id}`, now);
            list.innerHTML = '<p class="empty-notification-message">Stay tuned for collection updates!</p>';
            updateBadge(0);
        };
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
            panel.classList.remove('active');
        }
    });

    // Fetch user profile from Supabase
    const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    const userBarangay = userData?.barangay || userData?.profile?.barangay;
    if (list) list.innerHTML = '<p class="empty-notification-message">Stay tuned for other updates!</p>';

    // Load initial Notifications
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

/* 
   GUIDE MODAL LOGIC
*/
document.addEventListener('DOMContentLoaded', async () => {
    
    // 1. Initialize Supabase Notifications
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        initNotifications(user); 
    }

    // 2. Guide Modal Logic
    const modalOverlay = document.getElementById('guideModalOverlay');
    const modalDesc = document.getElementById('modalDesc');
    const modalList = document.getElementById('modalList');
    const closeBtn = document.getElementById('modalCloseBtn');

    const modalData = {
        bioModal: {
            desc: 'Leftover food and kitchen scraps.',
            items: ['Fruit and vegetable peelings.', 'Garden waste (dried leaves, grass clippings, small twigs).', 'Eggshells and coffee grounds.']
        },
        recyModal: {
            desc: 'Items that can still be processed and used as raw materials.',
            items: ['Plastics: Plastic bottles (PET), containers, and jugs.', 'Metals: Aluminum soda cans, tin cans, and scrap metal.', 'Glass: Empty glass bottles and jars (non-broken).', 'Paper: Old newspapers, magazines, cardboard boxes, and office paper.']
        },
        residModal: {
            desc: 'Non-hazardous materials that have no further use.',
            items: ['Soiled food wrappers and plastic sachets (shampoo, coffee, or snack packs).', 'Used tissues, napkins, and disposable diapers.', 'Worn-out rags and rubber materials.', 'Styrofoam packaging (if not accepted by local recyclers).']
        },
        hazModal: {
            desc: 'Materials that contain toxic substances.',
            items: ['Electronic Waste (E-waste): Old phones, chargers, and broken appliances.', 'Chemicals: Used batteries, light bulbs (CFLs and fluorescent tubes), and empty spray cans.', 'Medical Waste: Expired medicines and used face masks (in a household setting, these are often bagged separately).']
        }
    };

    if (modalOverlay && modalDesc && modalList) {
        document.querySelectorAll('.guide-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const data = modalData[btn.getAttribute('data-modal')];
                if(data) {
                    modalDesc.textContent = data.desc;
                    modalList.innerHTML = data.items.map(item => `<li>${item}</li>`).join('');
                    modalOverlay.style.display = 'flex';
                }
            });
        });
    }

    if (closeBtn && modalOverlay) {
        closeBtn.onclick = () => modalOverlay.style.display = 'none';
    }

    if (modalOverlay) {
        window.onclick = (e) => {
            if(e.target == modalOverlay) {
                modalOverlay.style.display = 'none';
            }
        };
    }
});