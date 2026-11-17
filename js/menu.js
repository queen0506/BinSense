import { supabase } from './supabase-init.js';

// POP UP ICONS
const POPUP_ICONS = {
    success: '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></svg>',
    error:   '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>',
    warning: '<svg viewBox="0 0 24 24"><line x1="12" y1="6" x2="12" y2="13"></line><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
};

function showMenuPopup(type, title, message) {
    const overlay = document.getElementById('menu-popup');
    const box = document.getElementById('menu-popup-box');
    const btn = document.getElementById('menu-popup-close');
    if (!overlay) return;

    box.className = `menu-popup-box ${type}`;
    document.getElementById('menu-popup-icon').innerHTML = POPUP_ICONS[type];
    document.getElementById('menu-popup-title').textContent = title;
    document.getElementById('menu-popup-text').textContent = message;
    overlay.classList.add('show');

    const close = () => {
        overlay.classList.remove('show');
        btn.removeEventListener('click', close);
    };
    btn.addEventListener('click', close);
}
async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        const { error } = await supabase
            .from('system_logs')
            .insert([
                {
                    email: user.email,
                    action: action,
                    message: message,
                    timestamp: new Date().toISOString()
                }
            ]);

        if (error) throw error;
    } catch (err) {
        console.error("Log error:", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const feedbackModal = document.getElementById('feedbackModal');
    const bugModal = document.getElementById('bugModal');
    const logoutModal = document.getElementById('logoutModal');
    const feedbackForm = document.getElementById('feedback-form');
    const bugReportForm = document.getElementById('bug-report-form');
    const feedbackText = document.getElementById('feedbackText');
    const bugTitle = document.getElementById('bug-title');
    const bugDescription = document.getElementById('bug-description');
    const bugSeverity = document.getElementById('bug-severity');

    supabase.auth.getUser().then(({ data: { user } }) => {
        const nameElement = document.getElementById('menu-user-name');
        if (user && nameElement) {
            nameElement.textContent = `Hi, ${user.user_metadata?.full_name || 'User'}`;
        }
    });

    // 1. OPEN MODALS
    document.getElementById('openFeedback')?.addEventListener('click', (e) => {
        e.preventDefault();
        feedbackModal.style.display = 'flex';
    });

    document.getElementById('openBug')?.addEventListener('click', (e) => {
        e.preventDefault();
        bugModal.style.display = 'flex';
    });

    // 2. CLOSE MODALS
    document.getElementById('cancelBtn')?.addEventListener('click', () => feedbackModal.style.display = 'none');
    document.getElementById('cancelBug')?.addEventListener('click', () => bugModal.style.display = 'none');
    document.getElementById('cancelLogout')?.addEventListener('click', () => logoutModal.style.display = 'none'); // New Close Logic

    // 3. STAR RATING
    let currentRating = 0;
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.addEventListener('click', () => {
            currentRating = parseInt(star.getAttribute('data-value'));
            stars.forEach((s, i) => s.style.color = i < currentRating ? "#99cc33" : "#ccc");
        });
    });

    // 4. SUBMIT FEEDBACK
    feedbackForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const message = feedbackText.value.trim();
        if (!Number.isInteger(currentRating) || currentRating < 1 || currentRating > 5) {
            showMenuPopup('warning', 'Rating Needed', 'Please select a rating from 1 to 5.');
            return;
        }
        if (!message) {
            showMenuPopup('warning', 'Message Needed', 'Please enter your feedback message.');
            feedbackText.focus();
            return;
        }

        try {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (!user?.email) throw new Error('You must be logged in to send feedback.');

            const { error: dbError } = await supabase.from('feedbacks').insert([{
                email: user.email,
                rating: currentRating,
                message,
                timestamp: new Date().toISOString()
            }]);
            if (dbError) throw dbError;

            await writeLog('Feedback', `User gave ${currentRating} stars`);
            feedbackForm.reset();
            currentRating = 0;
            stars.forEach(star => star.style.color = '#ccc');
            feedbackModal.style.display = 'none';
            showMenuPopup('success', 'Feedback Sent!', 'Thank you for helping us improve BinSense.');
        } catch (error) {
            console.error('Feedback database error:', error.message || error);
            showMenuPopup('error', 'Something Went Wrong', `Failed to send feedback: ${error.message || 'Please try again.'}`);
        }
    });

    // 5. SUBMIT BUG REPORT
    bugReportForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const title = bugTitle.value.trim();
        const description = bugDescription.value.trim();
        const severity = bugSeverity.value;
        if (!title || !description || !severity) {
            showMenuPopup('warning', 'Missing Details', 'Please provide a title, description, and severity.');
            return;
        }

        try {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (!user?.email) throw new Error('You must be logged in to report a bug.');

            const { error: dbError } = await supabase.from('incident_reports').insert([{
                email: user.email,
                title,
                description,
                severity,
                timestamp: new Date().toISOString()
            }]);
            if (dbError) throw dbError;

            await writeLog('Bug Report', `New bug report: ${title}`);
            bugReportForm.reset();
            bugModal.style.display = 'none';
            showMenuPopup('success', 'Bug Report Sent!', 'Thanks! Our team will look into it.');
        } catch (error) {
            console.error('Incident report database error:', error.message || error);
            showMenuPopup('error', 'Something Went Wrong', `Failed to submit bug report: ${error.message || 'Please try again.'}`);
        }
    });

    // 6. LOGOUT
    document.getElementById('menu-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.style.display = 'flex';
    });

    document.getElementById('confirmLogout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        localStorage.clear();
        window.location.href = "login.html";
    });
});