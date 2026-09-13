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
            alert("Please fill in all fields.");
            return;
        }

        if (newPass !== confirmPass) {
            alert("Passwords do not match.");
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            alert("User not logged in.");
            window.location.href = "../login.html";
            return;
        }

        try {
            if (!currentPass) throw new Error('Enter your current password to confirm this change.');
            const { error } = await supabase.auth.updateUser({ password: newPass });
            if (error) throw error;

            alert("Password changed successfully!");

            // Clear input fields
            document.getElementById("current-password").value = "";
            document.getElementById("new-password").value = "";
            document.getElementById("confirm-password").value = "";

            setTimeout(() => {
                window.location.href = "system-menu.html";
            }, 1500);

        } catch (error) {
            alert("Error: " + error.message);
        }
    });

    // =========================
    // 🗑 DELETE ACCOUNT
    // =========================
    const deleteBtn = document.getElementById("delete-account-trigger");

    deleteBtn?.addEventListener("click", async () => {

        const confirm1 = confirm("Are you sure you want to delete your account?");
        if (!confirm1) return;

        const confirm2 = confirm("This action is permanent. Continue?");
        if (!confirm2) return;

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            alert("No user logged in.");
            return;
        }

        alert('Account deletion requires a secure server-side Supabase account-deletion workflow and is not available from this browser.');
    });

});