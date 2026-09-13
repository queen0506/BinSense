import { supabase } from '../supabase-init.js';

// Helper function for logging
async function writeLog(action, message, category = 'logs') {
    const { data: { user } } = await supabase.auth.getUser();
    try {
        await supabase.from('system_logs').insert({
            action, message, category,
            timestamp: new Date().toISOString(),
            email: user ? user.email : "System",
            role: "Collector"
        });
    } catch (e) { console.error("Logging failed", e); }
}

document.addEventListener('DOMContentLoaded', () => {
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => { window.location.href = "collection-menu.html"; };
    }

    const editForm = document.querySelector('.edit-form');
    const toast = document.getElementById('toast'); 
    const currentUserNameEl = document.getElementById('current-user-name');

    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (user) {
            const displayName = user.user_metadata?.full_name || 'User';
            if (currentUserNameEl) currentUserNameEl.textContent = displayName;
            const nameInput = document.getElementById('fullName');
            const emailInput = document.getElementById('emailAddress');
            if (nameInput && !nameInput.value) nameInput.value = user.user_metadata?.full_name || '';
            if (emailInput && !emailInput.value) emailInput.value = user.email || '';
        } else {
            window.location.href = 'collection-login.html';
        }
    });

    function showNotification(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast show ${isError ? 'error' : ''}`;
        setTimeout(() => { toast.classList.remove('show'); }, 3000);
    }

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const { data: { user } } = await supabase.auth.getUser();
            const newName = document.getElementById('fullName').value;

            if (user) {
                try {
                    const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
                    if (error) throw error;
                    
                    // AUDIT TRAIL: Record profile change
                    await writeLog("Profile Updated", `User changed display name to: ${newName}`, "audit");

                    showNotification("Information updated successfully!");
                    setTimeout(() => { window.location.href = 'collection-menu.html'; }, 2000);
                } catch (error) {
                    showNotification("Failed to update: " + error.message, true);
                }
            } else {
                showNotification("No user logged in.", true);
            }
        });
    }
});