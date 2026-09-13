import { supabase } from '../supabase-init.js';

// Helper for System Logs & Audits
async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        await supabase.from('system_logs').insert({
            email: user.email,
            action: action,
            message: message,
            timestamp: new Date().toISOString()
        });
    } catch (err) { 
        console.error("Log error:", err); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const feedbackModal = document.getElementById('feedbackModal');
    const bugModal = document.getElementById('bugModal');
    const logoutModal = document.getElementById('logoutModal');

    // --- 1. DISPLAY NAME ---
    const menuUserNameEl = document.getElementById('menu-user-name');
    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (user && menuUserNameEl) {
            const displayName = user.user_metadata?.full_name || 'Collection Personnel';
            menuUserNameEl.textContent = `Hi, ${displayName}`;
        }
    });

    // --- 2. OPEN MODALS ---
    document.getElementById('openFeedback')?.addEventListener('click', (e) => {
        e.preventDefault();
        feedbackModal.style.display = 'flex';
    });

    document.getElementById('openBug')?.addEventListener('click', (e) => {
        e.preventDefault();
        bugModal.style.display = 'flex';
    });

    // --- 3. CLOSE MODALS ---
    document.getElementById('cancelBtn')?.addEventListener('click', () => feedbackModal.style.display = 'none');
    document.getElementById('cancelBug')?.addEventListener('click', () => bugModal.style.display = 'none');
    document.getElementById('cancelLogout')?.addEventListener('click', () => logoutModal.style.display = 'none');

    // --- 4. STAR RATING LOGIC ---
    let currentRating = 0;
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.onclick = () => {
            currentRating = parseInt(star.getAttribute('data-value'));
            stars.forEach((s, i) => {
                if (i < currentRating) {
                    s.classList.add('active');
                    s.style.color = "#99cc33";
                } else {
                    s.classList.remove('active');
                    s.style.color = "#ccc";
                }
            });
        };
    });

    // --- 5. SUBMIT FEEDBACK ---
    const feedbackBtn = feedbackModal?.querySelector('.btn-submit');
    if (feedbackBtn) {
        feedbackBtn.onclick = async () => {
            const text = document.getElementById('feedbackText').value.trim();
            
            if (currentRating === 0) return alert("Please select a rating.");

            try {
                const { data: { user } } = await supabase.auth.getUser();
                await supabase.from('feedbacks').insert({
                    email: user?.email || "Guest",
                    rating: currentRating,
                    message: text,
                    timestamp: new Date().toISOString()
                });

                await writeLog("Feedback", `Collector gave ${currentRating} stars`);
                alert("Feedback sent!");
                
                // Clear and Close
                document.getElementById('feedbackText').value = "";
                stars.forEach(s => {
                    s.classList.remove('active');
                    s.style.color = "#ccc";
                });
                currentRating = 0;
                feedbackModal.style.display = 'none';
            } catch (error) {
                console.error("Feedback Error:", error);
                alert("Failed to send feedback.");
            }
        };
    }

    // --- 6. SUBMIT BUG REPORT ---
    const bugBtn = bugModal?.querySelector('.btn-submit');
    if (bugBtn) {
        bugBtn.onclick = async () => {
            const titleInput = document.getElementById('bugTitle') || bugModal.querySelector('input[type="text"]');
            const descInput = document.getElementById('bugDesc') || bugModal.querySelector('textarea');
            const severityInput = document.getElementById('bugSeverity') || bugModal.querySelector('select');

            const title = titleInput.value.trim();
            const desc = descInput.value.trim();
            const severity = severityInput.value;

            if (!title) return alert("Please enter a title.");

            try {
                const { data: { user } } = await supabase.auth.getUser();
                await supabase.from('incident_reports').insert({
                    email: user?.email || "Guest",
                    title: title,
                    description: desc,
                    severity: severity,
                    timestamp: new Date().toISOString()
                });

                await writeLog("Bug Report", `New Bug from Collector: ${title}`);
                alert("Bug reported!");

                // Clear and Close
                titleInput.value = "";
                descInput.value = "";
                bugModal.style.display = 'none';
            } catch (error) {
                console.error("Bug Error:", error);
                alert("Failed to report bug.");
            }
        };
    }

    // --- 7. LOGOUT (WITH CONFIRMATION) ---
    document.getElementById('menu-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.style.display = 'flex'; // Intercept and show modal
    });

    document.getElementById('confirmLogout')?.addEventListener('click', async () => {
        try {
            await writeLog("Logout", "User logged out from collection menu");
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            localStorage.clear();
            window.location.href = '../login.html';
        } catch (err) {
            console.error("Logout failed", err);
        }
    });

    // --- 8. CLICK OUTSIDE TO CLOSE ---
    window.addEventListener('click', (e) => {
        if (e.target === feedbackModal) feedbackModal.style.display = 'none';
        if (e.target === bugModal) bugModal.style.display = 'none';
        if (e.target === logoutModal) logoutModal.style.display = 'none';
    });
});