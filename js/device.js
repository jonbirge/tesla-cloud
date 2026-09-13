// Device form-factor detection.
//
// Neither the viewport width nor the user agent can identify a phone here:
//
//   - Tesla's 2026.26 update raised the in-car browser's device pixel ratio
//     from 1.0 to 1.53, cutting the reported CSS width by about a third and
//     pulling the car below the 900px breakpoint.
//   - The in-car browser has been observed presenting itself as mobile, and
//     Tesla has changed the UA across releases, so a UA token is not something
//     to hang the layout on.
//
// The physical display is the signal that holds up. A phone's short edge is
// around 400 CSS px; the car's is roughly twice that even after the density
// change, so the two ranges don't overlap. screen.* describes the display
// itself, so it is unaffected by window size and by how the page is zoomed.
//
// ?layout=desktop / ?layout=mobile forces the choice and is remembered on this
// device; ?layout=auto clears it. The override is deliberately per-device
// (localStorage, not synced settings) so forcing the car to desktop doesn't
// also force a phone out of the mobile layout.
//
// This is a classic script rather than a module so the layout class lands
// before first paint and so faq.html, which loads no modules, gets it too.
// isMobileLayout() is a deliberate global for the same reason.
(function () {
    const PHONE_MAX_EDGE = 550; // CSS px: phones land near 400, the car near 780
    const OVERRIDE_KEY = 'layout-override';
    const ua = navigator.userAgent;

    function readOverride() {
        let override = null;
        try {
            const param = new URLSearchParams(window.location.search).get('layout');
            if (param === 'auto') {
                localStorage.removeItem(OVERRIDE_KEY);
            } else if (param === 'desktop' || param === 'mobile') {
                localStorage.setItem(OVERRIDE_KEY, param);
            }
            override = localStorage.getItem(OVERRIDE_KEY);
        } catch (e) {
            // Private mode or blocked storage: fall through to detection.
        }
        return override;
    }

    function isMobileDevice() {
        const override = readOverride();
        if (override) {
            return override === 'mobile';
        }

        // The car identifies itself when it can be trusted to, and never wants
        // the phone layout regardless of what the rest of the UA claims.
        if (/Tesla\//i.test(ua) || /TESLA_AUTO/i.test(ua)) {
            return false;
        }

        const shortEdge = Math.min(screen.width || 0, screen.height || 0);
        if (shortEdge > 0) {
            return shortEdge <= PHONE_MAX_EDGE;
        }

        // screen.* unavailable: fall back to form-factor hints.
        if (navigator.userAgentData) {
            return navigator.userAgentData.mobile;
        }
        return /iPad|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua);
    }

    if (isMobileDevice()) {
        document.documentElement.classList.add('mobile-device');
    }

    // True when the narrow-screen layout is actually in effect. Must stay in
    // sync with the @media blocks gated on html.mobile-device.
    window.isMobileLayout = function () {
        return document.documentElement.classList.contains('mobile-device')
            && window.matchMedia('only screen and (max-width: 900px)').matches;
    };
})();
