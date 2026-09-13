import { supabase } from '../supabase-init.js';

document.addEventListener('DOMContentLoaded', () => {
    // BACK BUTTON
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "system-menu.html";
        };
    }

    const editForm = document.querySelector('.edit-form');
    const toast = document.getElementById('toast'); // Make sure this ID exists in your HTML
    const currentUserNameEl = document.getElementById('current-user-name');

    // Show logged-in user info for this screen
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
            window.location.href = '../login.html';
        }
    });

    // Function to show notification
    function showNotification(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        toast.style.backgroundColor = isError ? "#ff4d4d" : "#333";
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // Stop page refresh

            const { data: { user } } = await supabase.auth.getUser();

            const newName = document.getElementById('fullName').value;
            const newEmail = document.getElementById('emailAddress').value;

            if (user) {
                try {
                    const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
                    if (error) throw error;
                    await supabase.from('users').update({ name: newName }).eq('id', user.id);

                    // Note: Changing Email requires a separate 'updateEmail' call 
                    // and usually re-authentication for security. 
                    // For now, we update the Display Name.

                    showNotification("Information updated successfully!");

                    // Optional: Redirect back to more page after short delay
                    setTimeout(() => {
                        window.location.href = 'system-menu.html';
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