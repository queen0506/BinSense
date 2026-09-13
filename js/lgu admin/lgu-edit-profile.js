import { supabase } from '../supabase-init.js';

/**
 * Helper for System Logs & Audits
 */
async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        await supabase.from('system_logs').insert({
            email: user.email,
            action,
            message,
            timestamp: new Date().toISOString()
        });
    } catch (err) { 
        console.error("Log error:", err); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // BACK BUTTON - Pointing to the HTML file
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "lgu-menu.html";
        };
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
            // If logged out, go to login page
            window.location.href = '../login.html';
        }
    });

    function showNotification(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        toast.style.backgroundColor = isError ? "#ff4d4d" : "#99cc33"; 
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const { data: { user } } = await supabase.auth.getUser();
            const newName = document.getElementById('fullName').value.trim();

            if (user) {
                if (!newName) return showNotification("Name cannot be empty", true);

                try {
                    const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
                    if (error) throw error;
                    await supabase.from('users').update({ name: newName }).eq('id', user.id);

                    // Added Audit Log for Profile Update
                    await writeLog("Profile Update", `User updated display name to: ${newName}`);

                    showNotification("Information updated successfully!");

                    // FIXED: Redirecting to HTML page instead of JS file
                    setTimeout(() => {
                        window.location.href = 'lgu-menu.html';
                    }, 2000);

                } catch (error) {
                    console.error("Update Error:", error);
                    showNotification("Failed to update: " + error.message, true);
                }
            } else {
                showNotification("No user logged in.", true);
            }
        });
    }
});