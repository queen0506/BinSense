import { supabase } from '../supabase-init.js';

async function writeLog(action, message, category = 'logs') {
    const { data: { user } } = await supabase.auth.getUser();
    try {
        await supabase.from('system_logs').insert({
            action, message, category,
            timestamp: new Date().toISOString(),
            email: user ? user.email : "Unknown"
        });
    } catch (e) { console.error(e); }
}

document.addEventListener("DOMContentLoaded", () => {
    // BACK BUTTON FIX
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "collection-menu.html";
        };
    }

    const changeBtn = document.getElementById("change-password-btn");
    const deleteBtn = document.getElementById("delete-account-btn");

    changeBtn?.addEventListener("click", async () => {
        const currentPass = document.getElementById("current-password").value;
        const newPass = document.getElementById("new-password").value;
        const confirmPass = document.getElementById("confirm-password").value;

        if (newPass !== confirmPass) { alert("Passwords do not match."); return; }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not logged in.');
            const { error } = await supabase.auth.updateUser({ password: newPass });
            if (error) throw error;

            // LOGGING LOGIC (Audit Trail)
            await writeLog("Password Changed", "Collector updated account security settings.", "audit");

            alert("Password updated!");
        } catch (error) { alert("Error: " + error.message); }
    });

    deleteBtn?.addEventListener("click", async () => {
        const { data: { user } } = await supabase.auth.getUser();
        const password = prompt("Enter password to confirm account deletion:");
        if (!password) return;

        try {
            await writeLog("Account Deleted", `User ${user.email} removed their profile.`, "audit");
            alert("Account deletion requires an administrator-managed server endpoint.");
        } catch (error) { alert("Error: " + error.message); }
    });
});