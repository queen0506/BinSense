import { confirmAccountDeletion } from './action-confirmation.js';
import { showPasswordNotification } from './password-notification.js';
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
            showPasswordNotification("Please fill in all fields.", "error");
            return;
        }

        if (newPass !== confirmPass) {
            showPasswordNotification("Passwords do not match.", "error");
            return;
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user?.email) {
            showPasswordNotification("User not logged in.", "error", 1500);
            setTimeout(() => {
                window.location.href = "login.html";
            }, 1500);
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

            showPasswordNotification("Password changed successfully!");

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
                showPasswordNotification("Current password is incorrect.", "error");
            } else if (error.message?.toLowerCase().includes('password')) {
                showPasswordNotification("New password is too weak.", "error");
            } else {
                showPasswordNotification("Error: " + error.message, "error");
            }
        }
    });

        // =========================
    // 🗑 DELETE ACCOUNT
    // =========================
    const deleteBtn = document.getElementById("delete-account-trigger");
    const deleteModal = document.getElementById("deleteAccountModal");
    const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
    const deletePasswordInput = document.getElementById("deleteConfirmPassword");
    const deleteModalError = document.getElementById("deleteModalError");

    if (deleteBtn && deleteModal) {
        // 1. Buksan ang Custom Modal
        deleteBtn.addEventListener("click", async () => {
            // Dito muna yung unang confirmation (kung meron ka nang confirmAccountDeletion)
            if (!await confirmAccountDeletion()) return;

            // Ipakita ang modal
            deletePasswordInput.value = ""; 
            deleteModalError.style.display = "none";
            deleteModal.classList.add("show");
            deletePasswordInput.focus();
        });

        // 2. Isara ang Modal kapag Cancel
        cancelDeleteBtn.addEventListener("click", () => {
            deleteModal.classList.remove("show");
        });

        // 3. Magpatuloy sa Deletion
        confirmDeleteBtn.addEventListener("click", async () => {
            const password = deletePasswordInput.value.trim();

            if (!password) {
                deleteModalError.textContent = "Password is required.";
                deleteModalError.style.display = "block";
                return;
            }

            // Loading state sa button
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = "Verifying...";
            deleteModalError.style.display = "none";

            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError || !user?.email) {
                deleteModalError.textContent = "No user logged in.";
                deleteModalError.style.display = "block";
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = "Delete Account";
                return;
            }

            try {
                // I-verify ang password
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

                deleteModal.classList.remove("show");
                alert("Account deleted successfully.");

                localStorage.clear();
                sessionStorage.clear();

                setTimeout(() => {
                    window.location.href = "login.html";
                }, 2000);

            } catch (error) {
                await writeLog("Failed Account Deletion", `Attempt failed: ${error.message || 'unknown error'}`, "audit");

                // I-reset ang button at ipakita ang error sa loob ng modal
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = "Delete Account";

                if (error.message?.toLowerCase().includes('invalid login credentials')) {
                    deleteModalError.textContent = "Incorrect password. Please try again.";
                } else {
                    deleteModalError.textContent = error.message || "An error occurred.";
                }
                deleteModalError.style.display = "block";
            }
        });
    }

});