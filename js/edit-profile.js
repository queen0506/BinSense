import { supabase } from './supabase-init.js';

/* ============================
   HELPER: SYSTEM LOGGING
============================ */
async function writeLog(action, message, category = "logs") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        const { error } = await supabase
            .from('system_logs')
            .insert([
                {
                    email: user.email,
                    role: localStorage.getItem('userRole') || "citizen",
                    action: action,
                    message: message,
                    category: category,
                    timestamp: new Date().toISOString()
                }
            ]);

        if (error) throw error;
    } catch (err) {
        console.error("Profile Log failed:", err);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => { window.location.href = "menu.html"; };
    }

    const editForm = document.querySelector('.edit-form');
    const toast = document.getElementById('toast'); 
    const currentUserNameEl = document.getElementById('current-user-name');

    // Show logged-in user info
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
        if (currentUserNameEl) currentUserNameEl.textContent = displayName;

        const nameInput = document.getElementById('fullName');
        const emailInput = document.getElementById('emailAddress');
        const barangayInput = document.getElementById('barangay');

        if (nameInput) nameInput.value = displayName;
        if (emailInput) emailInput.value = user.email || '';

        // FETCH EXISTING BARANGAY FROM SUPABASE
        const { data: userData } = await supabase
            .from('users')
            .select('barangay')
            .eq('id', user.id)
            .single();

        if (userData?.barangay && barangayInput) {
            barangayInput.value = userData.barangay;
        }

    } else {
        window.location.href = 'login.html';
        return;
    }

    function showNotification(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        toast.style.backgroundColor = isError ? "#ff4d4d" : "#48742C";
        toast.classList.add('show');
        setTimeout(() => { toast.classList.remove('show'); }, 3000);
    }

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault(); 

            const { data: { user } } = await supabase.auth.getUser();
            const newName = document.getElementById('fullName').value.trim();
            const newBarangay = document.getElementById('barangay').value;

            if (user) {
                try {
                    // 1. Update Profile Metadata in Supabase Auth
                    const { error: authError } = await supabase.auth.updateUser({
                        data: { full_name: newName }
                    });

                    if (authError) throw authError;

                    // 2. Upsert Name and Barangay in Database Table
                    const { error: dbError } = await supabase
                        .from('users')
                        .upsert({
                            id: user.id,
                            email: user.email,
                            name: newName,
                            barangay: newBarangay,
                            role: localStorage.getItem('userRole') || "citizen"
                        });

                    if (dbError) throw dbError;

                    // 3. RECORD AUDIT LOG
                    await writeLog(
                        "Profile Update", 
                        `User updated name to ${newName} and location to ${newBarangay}`, 
                        "logs"
                    );

                    showNotification("Information updated successfully!");

                    setTimeout(() => { window.location.href = 'menu.html'; }, 2000);

                } catch (error) {
                    console.error("Update Error:", error);
                    showNotification("Failed to update: " + error.message, true);
                    await writeLog("Failed Profile Update", error.message, "audit");
                }
            } else {
                showNotification("No user logged in.", true);
            }
        });
    }
});