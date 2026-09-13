import { supabase } from './supabase-init.js';

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
            alert('Please select a rating from 1 to 5.');
            return;
        }
        if (!message) {
            alert('Please enter your feedback message.');
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
            alert('Feedback sent successfully. Thank you.');
        } catch (error) {
            console.error('Feedback database error:', error.message || error);
            alert(`Failed to send feedback: ${error.message || 'Please try again.'}`);
        }
    });

    // 5. SUBMIT BUG REPORT
    bugReportForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const title = bugTitle.value.trim();
        const description = bugDescription.value.trim();
        const severity = bugSeverity.value;
        if (!title || !description || !severity) {
            alert('Please provide a title, description, and severity.');
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
            alert('Bug report submitted successfully.');
        } catch (error) {
            console.error('Incident report database error:', error.message || error);
            alert(`Failed to submit bug report: ${error.message || 'Please try again.'}`);
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