import { showAccountDeletionUnavailable } from '../action-confirmation.js';
import { showPasswordNotification } from '../password-notification.js';
import { supabase } from '../supabase-init.js';

document.addEventListener("DOMContentLoaded", () => {

    // ✅ BACK BUTTON (FIXED)
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "system-menu.html";
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

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            showPasswordNotification("User not logged in.", "error", 1500);
            setTimeout(() => {
                window.location.href = "../login.html";
            }, 1500);
            return;
        }

        try {
            if (!currentPass) throw new Error('Enter your current password to confirm this change.');
            const { error } = await supabase.auth.updateUser({ password: newPass });
            if (error) throw error;

            showPasswordNotification("Password changed successfully!");

            // Clear input fields
            document.getElementById("current-password").value = "";
            document.getElementById("new-password").value = "";
            document.getElementById("confirm-password").value = "";

            setTimeout(() => {
                window.location.href = "system-menu.html";
            }, 1500);

        } catch (error) {
            showPasswordNotification("Error: " + error.message, "error");
        }
    });

    // =========================
    // 🗑 DELETE ACCOUNT
    // =========================
    const deleteBtn = document.getElementById("delete-account-trigger");

    deleteBtn?.addEventListener('click', () => showAccountDeletionUnavailable());

});