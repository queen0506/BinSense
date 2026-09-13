document.addEventListener("DOMContentLoaded", () => {

    //  BACK BUTTON
    const backBtn = document.getElementById("back-btn");
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = "menu.html";
        };
    }

    //  CONTACT DEVELOPER FUNCTION
    const contactBtn = document.getElementById("contact-dev-btn");
    if (contactBtn) {
        contactBtn.addEventListener("click", (e) => {
            // This ensures the link works smoothly
            const email = "qnrj.05@gmail.com";
            const subject = "Inquiry: BinSense Project";
            const body = "Hello, I am using the BinSense App and I would like to reach out regarding...";

            // Update the href dynamically to include a professional subject line
            contactBtn.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            
            console.log("Redirecting to email client...");
        });
    }

    // Professional Project Log
    console.log("BinSense v1.0.0 | IoT Waste Management | Gordon College");
});