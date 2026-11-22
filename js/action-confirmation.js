const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('../css/action-confirmation.css', import.meta.url).href;
document.head.append(stylesheet);

let activeDialog;

export function confirmAction({ title, message, action, cancel = 'Go Back', tone = 'warning' }) {
    if (activeDialog) return Promise.resolve(false);

    const opener = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'action-confirmation';
    dialog.dataset.tone = tone;
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'action-confirmation-title');
    dialog.setAttribute('aria-describedby', 'action-confirmation-message');
    dialog.innerHTML = `
        <span class="action-confirmation-icon" aria-hidden="true">!</span>
        <h2 id="action-confirmation-title"></h2>
        <p id="action-confirmation-message"></p>
        <form method="dialog">
            <button type="submit" value="cancel" autofocus></button>
            <button type="submit" value="confirm"></button>
        </form>
    `;

    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = message;
    const cancelButton = dialog.querySelector('[value="cancel"]');
    cancelButton.hidden = !cancel;
    cancelButton.textContent = cancel || '';
    const confirmButton = dialog.querySelector('[value="confirm"]');
    confirmButton.textContent = action;
    if (!cancel) confirmButton.autofocus = true;

    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            activeDialog = undefined;
            dialog.remove();
            if (opener?.isConnected) opener.focus();
            resolve(dialog.returnValue === 'confirm');
        }, { once: true });
        activeDialog = dialog;
        document.body.append(dialog);
        dialog.showModal();
    });
}

export function confirmDiscard(message) {
    return confirmAction({
        title: 'Discard your changes?',
        message,
        action: 'Discard Changes',
        cancel: 'Keep Editing'
    });
}

export function confirmAccountDeletion() {
    return confirmAction({
        title: 'Permanently delete your account?',
        message: 'Account deletion is permanent and cannot be undone. You’ll need to verify your password to continue.',
        action: 'Continue',
        cancel: 'Cancel',
        tone: 'danger'
    });
}

export function showAccountDeletionUnavailable() {
    return confirmAction({
        title: 'Account deletion unavailable',
        message: 'Account deletion is not enabled for this role.',
        action: 'Got It',
        cancel: null,
        tone: 'info'
    });
}
