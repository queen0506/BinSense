const SUCCESS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.2 4.2L19 7"></path></svg>';
const ERROR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5M12 16.5h.01"></path></svg>';

let notification;
let dismissTimer;
let transitionTimer;

export function showPasswordNotification(message, type = 'success', duration) {
    const isError = type === 'error';

    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'password-notification';
        notification.hidden = true;
        notification.innerHTML = '<span class="password-notification-icon"></span><p class="password-notification-message"></p>';
        document.querySelector('.password-card').append(notification);
    }

    clearTimeout(dismissTimer);
    clearTimeout(transitionTimer);

    notification.classList.remove('is-leaving');
    notification.hidden = false;
    notification.dataset.type = isError ? 'error' : 'success';
    notification.setAttribute('role', isError ? 'alert' : 'status');
    notification.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    notification.setAttribute('aria-atomic', 'true');
    notification.querySelector('.password-notification-icon').innerHTML = isError ? ERROR_ICON : SUCCESS_ICON;
    notification.querySelector('.password-notification-message').textContent = message;

    void notification.offsetWidth;
    notification.classList.add('is-visible');

    dismissTimer = setTimeout(() => {
        notification.classList.remove('is-visible');
        notification.classList.add('is-leaving');
        transitionTimer = setTimeout(() => {
            notification.classList.remove('is-leaving');
            notification.hidden = true;
        }, 220);
    }, duration ?? (isError ? 6000 : 4500));
}
