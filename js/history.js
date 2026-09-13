// Notification System
class NotificationManager {
    constructor() {
        this.notifications = this.loadNotifications();
        this.init();
    }

    loadNotifications() {
        const saved = localStorage.getItem('notifications');
        if (saved) {
            return JSON.parse(saved);
        }
        // Start with an empty array while data listeners populate the history.
        return [];
    }

    saveNotifications() {
        localStorage.setItem('notifications', JSON.stringify(this.notifications));
    }

    init() {
        const notificationBtn = document.getElementById('notificationBtn');
        const notificationPanel = document.getElementById('notificationPanel');
        const closeBtn = document.getElementById('closeNotificationBtn');
        const clearAllBtn = document.getElementById('clearAllBtn');

        // Toggle notification panel
        if (notificationBtn) {
            notificationBtn.addEventListener('click', () => {
                notificationPanel.classList.toggle('active');
                this.renderNotifications();
                // Mark as read when opened
                this.markAllAsRead();
            });
        }

        // Close notification panel
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                notificationPanel.classList.remove('active');
            });
        }

        // Clear all notifications
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                this.clearAllNotifications();
            });
        }

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
                notificationPanel.classList.remove('active');
            }
        });

        // Initial render
        this.updateBadge();
        this.renderNotifications();
    }

    renderNotifications() {
        const notificationList = document.getElementById('notificationList');
        if (!notificationList) return;

        notificationList.innerHTML = '';

        if (this.notifications.length === 0) {
            notificationList.innerHTML = '<div class="empty-notification-message">No notifications</div>';
            return;
        }

        this.notifications.forEach(notification => {
            const notificationItem = document.createElement('div');
            notificationItem.className = `notification-item ${!notification.read ? 'unread' : ''}`;

            const iconEmoji = {
                'success': '✓',
                'warning': '⚠',
                'alert': '!'
            };

            notificationItem.innerHTML = `
                <div class="notification-icon-circle ${notification.type}">
                    ${iconEmoji[notification.type] || '•'}
                </div>
                <div class="notification-content">
                    <div class="notification-title">${notification.title}</div>
                    <div class="notification-message">${notification.message}</div>
                    <div class="notification-time">${notification.time}</div>
                </div>
            `;

            notificationList.appendChild(notificationItem);
        });
    }

    updateBadge() {
        const badge = document.getElementById('notificationBadge');
        const unreadCount = this.notifications.filter(n => !n.read).length;

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    markAllAsRead() {
        this.notifications.forEach(notification => {
            notification.read = true;
        });
        this.saveNotifications();
        this.updateBadge();
    }

    clearAllNotifications() {
        this.notifications = [];
        this.saveNotifications();
        this.renderNotifications();
        this.updateBadge();
    }

    addNotification(title, message, type = 'warning') {
        const notification = {
            id: Date.now(),
            title,
            message,
            type,
            time: 'just now',
            read: false
        };
        this.notifications.unshift(notification);
        this.saveNotifications();
        this.updateBadge();
        this.renderNotifications();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modalOverlay = document.getElementById('guideModalOverlay');
    const modalDesc = document.getElementById('modalDesc');
    const modalList = document.getElementById('modalList');
    const closeBtn = document.getElementById('modalCloseBtn');

    const modalData = {
        bioModal: {
            desc: 'Leftover food and kitchen scraps.',
            items: [
                'Fruit and vegetable peelings.',
                'Garden waste (dried leaves, grass clippings, small twigs).',
                'Eggshells and coffee grounds.'
            ]
        },
        recyModal: {
            desc: 'Items that can still be processed and used as raw materials.',
            items: [
                'Plastics: Plastic bottles (PET), containers, and jugs.',
                'Metals: Aluminum soda cans, tin cans, and scrap metal.',
                'Glass: Empty glass bottles and jars (non-broken).',
                'Paper: Old newspapers, magazines, cardboard boxes, and office paper.'
            ]
        },
        residModal: {
            desc: 'Non-hazardous materials that have no further use.',
            items: [
                'Soiled food wrappers and plastic sachets (shampoo, coffee, or snack packs).',
                'Used tissues, napkins, and disposable diapers.',
                'Worn-out rags and rubber materials.',
                'Styrofoam packaging (if not accepted by local recyclers).'
            ]
        },
        hazModal: {
            desc: 'Materials that contain toxic substances.',
            items: [
                'Electronic Waste (E-waste): Old phones, chargers, and broken appliances.',
                'Chemicals: Used batteries, light bulbs (CFLs and fluorescent tubes), and empty spray cans.',
                'Medical Waste: Expired medicines and used face masks (in a household setting, these are often bagged separately).',
            ]
        }
    };

    document.querySelectorAll('.guide-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const data = modalData[btn.getAttribute('data-modal')];
            modalDesc.textContent = data.desc;
            modalList.innerHTML = data.items.map(item => `<li>${item}</li>`).join('');
            modalOverlay.style.display = 'flex';
        });
    });

    closeBtn.onclick = () => modalOverlay.style.display = 'none';

    window.onclick = (e) => {
        if(e.target == modalOverlay) {
            modalOverlay.style.display = 'none';
        }
    };

    // Initialize Notification Manager
    const notificationManager = new NotificationManager();

    // Make it globally accessible for testing
    window.notificationManager = notificationManager;
});