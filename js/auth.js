import { supabase } from './supabase-init.js';

let isRegistrationInProgress = false;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

/* ====================================
   HELPER: SYSTEM LOGGING
==================================== */
async function writeLog(logData) {
    try {
        const { error } = await supabase
            .from('system_logs')
            .insert([
                {
                    email: logData.user,
                    role: logData.role,
                    action: logData.action,
                    message: logData.message,
                    category: logData.category,
                    timestamp: new Date().toISOString()
                }
            ]);

        if (error) throw error;
    } catch (err) {
        console.error("Auth Log failed:", err);
    }
}

/* ============================
   SECTION SWITCHING
============================ */
window.showRegister = () => {
    const loginSec = document.getElementById('login-section');
    const regSec = document.getElementById('register-section');
    if (loginSec) loginSec.style.display = 'none';
    if (regSec) regSec.style.display = 'block';
};

window.showLogin = () => {
    const loginSec = document.getElementById('login-section');
    const regSec = document.getElementById('register-section');
    const forgotSec = document.getElementById('forgot-section');
    if (regSec) regSec.style.display = 'none';
    if (forgotSec) forgotSec.style.display = 'none';
    if (loginSec) loginSec.style.display = 'block';
};

window.showForgot = () => {
    const loginSec = document.getElementById('login-section');
    const forgotSec = document.getElementById('forgot-section');
    if (loginSec) loginSec.style.display = 'none';
    if (forgotSec) forgotSec.style.display = 'block';
};

/* ============================
   ROLE LOGIC
============================ */
function getRoleByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (e.endsWith("@binsense.gov.ph")) return "system administrator";
    if (e.endsWith("@admin.gov.ph")) return "lgu admin";
    if (e.endsWith("@wastemanagement.com")) return "waste collector";
    return "citizen";
}

function getDashboardByRole(role) {
    if (role === 'system administrator') return 'system admin/system-management.html';
    if (role === 'lgu admin') return 'lgu admin/lgu-monitoring.html';
    if (role === 'waste collector') return 'collection personnel/collection-dashboard.html';
    return 'dashboard.html';
}

function getDashboardByEmail(email) {
    const e = String(email || '').trim().toLowerCase();

    // Domain mappings take priority over stale browser role data.
    if (e.endsWith("@binsense.gov.ph")) return getDashboardByRole('system administrator');
    if (e.endsWith("@admin.gov.ph")) return getDashboardByRole('lgu admin');
    if (e.endsWith("@wastemanagement.com")) return getDashboardByRole('waste collector');

    const storedRole = localStorage.getItem('userRole');
    return getDashboardByRole(storedRole || 'citizen');
}

/* ============================
   INITIALIZATION & EVENT LISTENERS
============================ */
document.addEventListener('DOMContentLoaded', () => {
    
    // LOGIN HANDLER
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('loginEmail').value.trim().toLowerCase();
            const pass = document.getElementById('loginPassword').value.trim();
            const errorBox = document.getElementById('login-error');

            if (!EMAIL_PATTERN.test(email)) {
                if (errorBox) {
                    errorBox.textContent = "Please enter a valid email address.";
                    errorBox.style.display = "block";
                } else {
                    alert("Please enter a valid email address.");
                }
                return;
            }

            if (!pass) {
                if (errorBox) {
                    errorBox.textContent = "Please enter your password.";
                    errorBox.style.display = "block";
                } else {
                    alert("Please enter your password.");
                }
                return;
            }

            try {
                // 1. Authenticate with Supabase
                const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: pass
                });

                if (authError) throw authError;

                const user = authData.user;

                // 2. CHECK DISABILITY & ENABLEMENT STATUS IN SUPABASE DB
                const { data: userData } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                if (userData && userData.is_disabled === true) {
                    await writeLog({
                        user: user.email,
                        role: userData.role || "unknown",
                        action: "Blocked Login",
                        message: "Disabled user attempted access",
                        category: "security"
                    });

                    await supabase.auth.signOut(); // Clear the session
                    if (errorBox) {
                        errorBox.textContent = "Your account is currently disabled.";
                        errorBox.style.display = "block";
                    }
                    return; 
                }

                const role = getRoleByEmail(email);
                localStorage.setItem('userRole', role);

                // 3. Upsert user record to ensure user info is stored
                await supabase
                    .from('users')
                    .upsert({
                        id: user.id,
                        name: user.user_metadata?.full_name || "User",
                        email: user.email,
                        role: role,
                        is_disabled: false
                    });

                // AUDIT LOG
                await writeLog({
                    user: user.email,
                    role: role,
                    action: "Login",
                    message: "User logged into the system",
                    category: "audit"
                });

                window.location.href = getDashboardByEmail(user.email);

            } catch (err) {
                console.error("Login Error:", err);
                let errorMessage = err.message || "Invalid email or password.";
                if (err.message === "Failed to fetch" || err.name === "TypeError") {
                    errorMessage = "Unable to connect to the authentication server. Please check your internet connection or make sure you are serving the page through a web server (e.g. Live Server).";
                }
                if (errorBox) {
                    errorBox.textContent = errorMessage;
                    errorBox.style.display = "block";
                } else {
                    alert(errorMessage);
                }
            }
        });
    }

    // REGISTRATION HANDLER
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('registerName').value.trim().replace(/\s+/g, ' ');
            const email = document.getElementById('registerEmail').value.trim().toLowerCase();
            const pass = document.getElementById('registerPassword').value.trim();
            const confirm = document.getElementById('registerConfirm').value.trim();

            if (!name || !email || !pass || !confirm) {
                return alert("Please fill in all fields.");
            }

            if (!EMAIL_PATTERN.test(email)) {
                return alert("Please enter a valid email address.");
            }

            if (pass !== confirm) {
                return alert("Passwords do not match.");
            }

            try {
                const messageBox = document.getElementById('register-message');
                const submitButton = document.getElementById('register-submit');

                const showRegistrationMessage = (message, isError = true) => {
                    if (!messageBox) return;
                    messageBox.textContent = message;
                    messageBox.style.color = isError ? 'red' : '#4d7f13';
                    messageBox.style.display = 'block';
                };

                if (!registerForm.checkValidity()) {
                    registerForm.reportValidity();
                    showRegistrationMessage('Please complete all required fields with a valid email address.');
                    return;
                }

                if (!PASSWORD_PATTERN.test(pass)) {
                    showRegistrationMessage('Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character.');
                    return;
                }

                const role = getRoleByEmail(email);

                // 1. Create User in Supabase Auth
                isRegistrationInProgress = true;
                if (submitButton) {
                    submitButton.disabled = true;
                    submitButton.textContent = 'CREATING ACCOUNT...';
                }
                showRegistrationMessage('Creating your account...', false);

                try {
                    const { data: authData, error: authError } = await supabase.auth.signUp({
                        email: email,
                        password: pass,
                        options: {
                            data: { full_name: name }
                        }
                    });

                    if (authError) throw authError;

                    const user = authData.user;

                    if (!user) {
                        throw new Error('Supabase did not return a user account.');
                    }

                    // 2. The database trigger creates a profile even before email confirmation.
                    // Update it here only when Auth returned a usable browser session.
                    if (authData.session) {
                        const { error: dbError } = await supabase
                            .from('users')
                            .upsert({
                                id: user.id,
                                name: name,
                                email: email,
                                role: role,
                                is_disabled: false
                            }, { onConflict: 'id' });

                        if (dbError) throw dbError;
                    }

                    // 3. AUDIT LOG
                    await writeLog({
                        user: email,
                        role: role,
                        action: "Account Created",
                        message: `${name} created a new ${role} account`,
                        category: "audit"
                    });

                    const confirmationRequired = !authData.session;
                    await supabase.auth.signOut();
                    const successMessage = confirmationRequired
                        ? 'Account created. Check your email to confirm it before logging in.'
                        : 'Account created successfully. You can now log in.';
                    showRegistrationMessage(successMessage, false);
                    alert(successMessage);
                    window.showLogin();
                } catch (err) {
                    console.error("Registration Error:", err);
                    const errorMessage = err.message || 'Unable to create your account.';
                    showRegistrationMessage(`Registration error: ${errorMessage}`);
                    alert(`Registration error: ${errorMessage}`);
                } finally {
                    isRegistrationInProgress = false;
                    if (submitButton) {
                        submitButton.disabled = false;
                        submitButton.textContent = 'SIGN UP';
                    }
                }

            } catch (err) {
                console.error("Registration form error:", err);
                alert("Registration error: " + (err.message || 'Unable to submit the form.'));
            }
        });
    }

    // PASSWORD TOGGLE
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-target');
            const input = document.getElementById(id);

            if (input) {
                if (input.type === "password") {
                    input.type = "text";
                    btn.classList.add("active");
                } else {
                    input.type = "password";
                    btn.classList.remove("active");
                }
            }
        });
    });
});

/* ============================
   SESSION WATCHER
============================ */
supabase.auth.onAuthStateChange(async (event, session) => {
    // Only auto-redirect on actual SIGNED_IN events, ignoring initial SIGNED_OUT or explicit SIGN_OUT events during registration
    if (session?.user && event === 'SIGNED_IN' && !isRegistrationInProgress) {
        const user = session.user;

        const { data: userData } = await supabase
            .from('users')
            .select('is_disabled')
            .eq('id', user.id)
            .single();

        if (userData && userData.is_disabled === true) {
            await supabase.auth.signOut();
            window.location.href = "login.html";
            return;
        }

        const path = window.location.pathname;
        const isLogin = path.includes("login.html") || path.endsWith("/");

        if (isLogin) {
            window.location.href = getDashboardByEmail(user.email);
        }
    }
});