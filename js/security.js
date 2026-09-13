import { supabase } from './supabase-init.js';

/* ==========================================================================
   HELPER: WRITE TO SYSTEM LOGS & AUDIT TRAIL
========================================================================== */
async function writeLog(action, message, category = "audit") {
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
        console.log(`Security Event Logged: ${action}`);
    } catch (err) {
        console.error("Audit Logging Error:", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {

    // ✅ BACK BUTTON
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "menu.html";
        };
    }

    // =========================
    //  CHANGE PASSWORD
    // =========================
    const changeBtn = document.getElementById("change-password-btn");

    changeBtn?.addEventListener("click", async () => {
        const currentPass = document.getElementById("current-password").value;
        const newPass = document.getElementById("new-password").value;
        const confirmPass = document.getElementById("confirm-password").value;

        if (!currentPass || !newPass || !confirmPass) {
            alert("Please fill in all fields.");
            return;
        }

        if (newPass !== confirmPass) {
            alert("Passwords do not match.");
            return;
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user?.email) {
            alert("User not logged in.");
            window.location.href = "login.html";
            return;
        }

        try {
            // Supabase requires a recent authentication before sensitive changes.
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPass
            });
            if (signInError) throw signInError;

            const { error: updateError } = await supabase.auth.updateUser({ password: newPass });
            if (updateError) throw updateError;

            // ✅ AUDIT LOG: SUCCESSFUL PASSWORD CHANGE
            await writeLog("Password Change", "User successfully updated their account password", "audit");

            alert("Password changed successfully!");

            // Clear input fields
            document.getElementById("current-password").value = "";
            document.getElementById("new-password").value = "";
            document.getElementById("confirm-password").value = "";

            setTimeout(() => {
                window.location.href = "menu.html";
            }, 1500);

        } catch (error) {
            // ✅ AUDIT LOG: FAILED ATTEMPT
            await writeLog("Failed Password Change", `Attempt failed: ${error.message || 'unknown error'}`, "audit");

            if (error.message?.toLowerCase().includes('invalid login credentials')) {
                alert("Current password is incorrect.");
            } else if (error.message?.toLowerCase().includes('password')) {
                alert("New password is too weak.");
            } else {
                alert("Error: " + error.message);
            }
        }
    });

    // =========================
    // 🗑 DELETE ACCOUNT
    // =========================
    const deleteBtn = document.getElementById("delete-account-trigger");

    deleteBtn?.addEventListener("click", async () => {
        const confirm1 = confirm("Are you sure you want to delete your account?");
        if (!confirm1) return;

        const confirm2 = confirm("This action is permanent and cannot be undone. Continue?");
        if (!confirm2) return;

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user?.email) {
            alert("No user logged in.");
            return;
        }

        const password = prompt("Enter your password to confirm account deletion:");
        if (!password) {
            alert("Password required to delete account.");
            return;
        }

        try {
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password
            });
            if (signInError) throw signInError;

            await writeLog("Account Deletion", "User permanently deleted their account and data", "audit");

            const { error: deleteError } = await supabase.rpc('delete_own_account');
            if (deleteError) {
                throw new Error('Account deletion is not configured. Add the delete_own_account server-side function before enabling this action.');
            }

            alert("Account deleted successfully.");

            // Clear all stored data
            localStorage.clear();
            sessionStorage.clear();

            setTimeout(() => {
                window.location.href = "login.html";
            }, 2000);

        } catch (error) {
            // ✅ AUDIT LOG: FAILED DELETION ATTEMPT
            await writeLog("Failed Account Deletion", `Attempt failed: ${error.message || 'unknown error'}`, "audit");

            if (error.message?.toLowerCase().includes('invalid login credentials')) {
                alert("Incorrect password. Account deletion cancelled.");
            } else {
                alert("Error: " + error.message);
            }
        }
    });

});