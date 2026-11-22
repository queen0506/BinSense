import { confirmDiscard } from '../action-confirmation.js';
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
    const feedbackModal = document.getElementById('feedbackModal');
    const bugModal = document.getElementById('bugModal');
    const logoutModal = document.getElementById('logoutModal'); // Added Reference

    // --- 1. DISPLAY NAME ---
    const menuUserNameEl = document.getElementById('menu-user-name');
    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (user && menuUserNameEl) {
            const displayName = user.user_metadata?.full_name || 'LGU Personnel';
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
    const dismissFeedback = async () => {
        const comment = feedbackModal.querySelector('textarea');
        if ((currentRating || comment.value) && !await confirmDiscard('Your unsent feedback will be lost.')) return;
        comment.value = '';
        currentRating = 0;
        stars.forEach(star => {
            star.classList.remove('active');
            star.style.removeProperty('color');
        });
        feedbackModal.style.display = 'none';
    };

    const dismissBugReport = async () => {
        const fields = [...bugModal.querySelectorAll('input[type="text"], textarea')];
        const severity = bugModal.querySelector('select');
        const hasDraft = fields.some(field => field.value) || severity.selectedIndex > 0;
        if (hasDraft && !await confirmDiscard('Your unsent bug report will be lost.')) return;
        fields.forEach(field => { field.value = ''; });
        severity.selectedIndex = 0;
        bugModal.style.display = 'none';
    };

    document.getElementById('cancelBtn')?.addEventListener('click', dismissFeedback);
    document.getElementById('cancelBug')?.addEventListener('click', dismissBugReport);
    document.getElementById('cancelLogout')?.addEventListener('click', () => logoutModal.style.display = 'none'); // Added Close Logic

    // --- 4. STAR RATING LOGIC ---
    let currentRating = 0;
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.onclick = () => {
            currentRating = parseInt(star.getAttribute('data-value'));
            stars.forEach((s, i) => {
                s.style.color = i < currentRating ? "#99cc33" : "#ccc";
            });
        };
    });

    // --- 5. SUBMIT FEEDBACK ---
    const feedbackBtn = feedbackModal?.querySelector('.btn-submit');
    if (feedbackBtn) {
        feedbackBtn.onclick = async () => {
            const text = document.getElementById('feedbackText').value.trim();
            if (currentRating === 0) return alert("Please select a star rating.");

            try {
                const { data: { user } } = await supabase.auth.getUser();
                const { error } = await supabase.from('feedbacks').insert({
                    email: user?.email || "Guest",
                    rating: currentRating,
                    message: text,
                    timestamp: new Date().toISOString()
                });
                if (error) throw error;
                await writeLog("Feedback", `LGU User gave ${currentRating} stars`);
                alert("Feedback sent! Thank you.");
                document.getElementById('feedbackText').value = "";
                stars.forEach(s => s.style.color = "#ccc");
                currentRating = 0;
                feedbackModal.style.display = 'none';
            } catch (err) {
                alert("Failed to send feedback.");
            }
        };
    }

    // --- 6. SUBMIT BUG REPORT ---
    const bugBtn = bugModal?.querySelector('.btn-submit');
    if (bugBtn) {
        bugBtn.onclick = async () => {
            const titleInput = bugModal.querySelector('input[type="text"]');
            const descInput = bugModal.querySelector('textarea');
            const severityInput = bugModal.querySelector('select');
            const title = titleInput.value.trim();

            if (!title) return alert("Please enter a title.");

            try {
                const { data: { user } } = await supabase.auth.getUser();
                const { error } = await supabase.from('incident_reports').insert({
                    email: user?.email || "Guest",
                    title: title,
                    description: descInput.value.trim(),
                    severity: severityInput.value,
                    timestamp: new Date().toISOString()
                });
                if (error) throw error;
                await writeLog("Bug Report", `LGU User reported: ${title}`);
                alert("Bug reported successfully.");
                titleInput.value = "";
                descInput.value = "";
                bugModal.style.display = 'none';
            } catch (err) {
                alert("Failed to submit bug report.");
            }
        };
    }

    // --- 7. LOGOUT (UPDATED WITH CONFIRMATION) ---
    const logoutTrigger = document.getElementById('menu-logout');
    if (logoutTrigger) {
        logoutTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            logoutModal.style.display = 'flex'; // Show modal instead of logging out immediately
        });
    }

    const confirmLogoutBtn = document.getElementById('confirmLogout');
    if (confirmLogoutBtn) {
        confirmLogoutBtn.addEventListener('click', async () => {
            await writeLog("Logout", "LGU User logged out");
            supabase.auth.signOut().then(() => {
                localStorage.clear();
                window.location.href = "../login.html";
            });
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === feedbackModal) dismissFeedback();
        if (e.target === bugModal) dismissBugReport();
        if (e.target === logoutModal) logoutModal.style.display = 'none'; // Close on background click
    });
});