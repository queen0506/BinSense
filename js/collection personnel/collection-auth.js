// --- 1. Imports ---
import { supabase } from '../supabase-init.js';

// --- 2. DOM Elements ---
const loginSec = document.getElementById('login-section');
const regSec = document.getElementById('register-section');
const forgotSec = document.getElementById('forgot-section');

// --- 3. UI Toggler Functions ---
window.showRegister = function() { // Added 'window.' to make these accessible globally if needed
    loginSec.style.display = 'none';
    regSec.style.display = 'block';
};

window.showLogin = function() {
    regSec.style.display = 'none';
    forgotSec.style.display = 'none';
    loginSec.style.display = 'block';
};

window.showForgot = function() {
    loginSec.style.display = 'none';
    forgotSec.style.display = 'block';
};

// --- 4. Form Handlers ---

// Handle Login
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = loginForm.querySelector('input[type=email]').value.trim();
        const password = loginForm.querySelector('input[type=password]').value.trim();
        const errorElement = document.getElementById('login-error');

        supabase.auth.signInWithPassword({ email, password })
            .then(({ error }) => {
                if (error) throw error;
                errorElement.style.display = 'none';
                errorElement.textContent = '';
                window.location.href = 'collection-dashboard.html';
            })
            .catch(err => {
                let message = 'Invalid email or password';

                if (err.status === 429) {
                    message = 'Too many failed login attempts. Please try again later.';
                } else if (err.code === 'invalid_credentials') {
                    message = 'Invalid email or password';
                } else if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                    message = 'Unable to connect to the authentication server. Please check your internet connection or run via a local web server (e.g. Live Server).';
                } else if (err.message) {
                    message = err.message;
                }

                errorElement.textContent = message;
                errorElement.style.display = 'block';
            });
    });
}

// Handle Registration
const registerForm = document.getElementById('register-form');
if (registerForm) {
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fullName = registerForm.querySelector('input[placeholder="Full name"]').value.trim();
        const email = registerForm.querySelector('input[type=email]').value.trim();
        const pass = registerForm.querySelector('input[placeholder="Password"]').value.trim();
        const confirm = registerForm.querySelector('input[placeholder="Confirm Password"]').value.trim();

        if (pass !== confirm) return alert('Passwords do not match');

        // Avoid automatic redirect while Supabase creates the account.
        suppressRedirect = true;
        supabase.auth.signUp({ email, password: pass, options: { data: { full_name: fullName } } })
            .then(async ({ error }) => {
                if (error) throw error;
                await supabase.auth.signOut();
                    suppressRedirect = false; // allow redirects again
                    alert('Account created! Please log in with your new credentials.');
                    // stay on same page, switch back to login UI and prefill email
                    showLogin();
                    const loginEmail = document.querySelector('#login-section input[type=email]');
                    if (loginEmail) loginEmail.value = email;
            })
            .catch(err => {
                suppressRedirect = false;
                alert("Registration Error: " + err.message);
            });
    });
}

// Handle Forgot Password
const forgotForm = document.getElementById('forgot-form');
if (forgotForm) {
    forgotForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = forgotForm.querySelector('input[type=email]').value.trim();
        
        supabase.auth.resetPasswordForEmail(email)
            .then(({ error }) => {
                if (error) throw error;
                alert('Reset link sent to your email!');
            })
            .catch(err => alert("Error: " + err.message));
    });
}

// --- 5. Security & Session Management ---

// allow temporarily suppressing automatic redirect (e.g. during registration)
let suppressRedirect = false;

// Redirect users based on login state
supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (suppressRedirect) return; // skip if we've asked to hold off

    const path = window.location.pathname;
    if (user) {
        // If logged in and on a login page, go to the matching dashboard
        if (path.includes("index.html") || path.includes("login.html")) {
            window.location.href = 'dashboard.html';
        } else if (path.includes("collection-login.html")) {
            window.location.href = 'collection-dashboard.html';
        }
    } else {
        // If NOT logged in and trying to access a dashboard, go to the matching login
        if (path.includes("dashboard.html") || path.includes("menu.html") || path.includes("analytics.html") || path.includes("history.html")) {
            window.location.href = 'login.html';
        } else if (path.includes("collection-dashboard.html") || path.includes("collection-menu.html") || path.includes("collection-analytics.html") || path.includes("collection-history.html")) {
            window.location.href = 'collection-login.html';
        }
    }
});

// Logout Function (Call this from a button in your dashboard)
window.logoutUser = function() {
    supabase.auth.signOut().then(({ error }) => {
        if (error) throw error;
        window.location.href = 'login.html';
    }).catch(err => alert("Error logging out: " + err.message));
};

// --- 6. Existing UI Utilities (Keep these) ---
document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
        const inp = btn.previousElementSibling;
        if (inp && inp.type === 'password') {
            inp.type = 'text';
            btn.textContent = 'Hide';
        } else if (inp) {
            inp.type = 'password';
            btn.textContent = 'Show';
        }
    });
});