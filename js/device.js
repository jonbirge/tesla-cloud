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
// The same update also made everything render about half again as large. What
// Tesla actually shipped is a browser-wide default page zoom, which Chromium
// folds into devicePixelRatio, so the panel still has its original physical
// pixels but describes itself in CSS px that are 1.53x bigger. Undoing it is
// therefore exactly 1/devicePixelRatio, applied as zoom on the root element so
// the whole design - type, padding, icons, touch targets - comes back to the
// physical size it had before, rather than only the text.
//
// Whether that undo is wanted cannot be read off devicePixelRatio alone: on a
// phone or a retina laptop a high ratio means genuinely smaller pixels, and
// shrinking there would be wrong. The physical panel tells the two apart.
// screen.* is in CSS px and so moves with the zoom, but screen.* x the ratio is
// device px and holds still across it: the car's panel is near 1200 device px
// on its short edge, while the retina displays that share the car's CSS
// dimensions (a 13" MacBook Air is 1280x800 CSS px at ratio 2) sit at 1600 and
// up, and the common 1080p laptop at 125% sits at 1080. A 1920x1200 desktop
// monitor run at 125% does land in the car's band, so a UA naming Windows,
// macOS or ChromeOS refuses the shrink outright - a desktop at 125% asked for
// that size. That test only ever refuses, so a car whose UA stops matching
// falls back to the panel test rather than being taken for a laptop.
//
// A car still on the old firmware reports ratio 1.0 and is left alone by the
// same rule that leaves an ordinary monitor alone: there is nothing to undo.
//
// ?layout=desktop / ?layout=mobile forces the choice and is remembered on this
// device; ?layout=auto clears it. ?scale=<0.5-1> does the same for UI scale and
// ?scale=auto clears it. The overrides are deliberately per-device
// (localStorage, not synced settings) so forcing the car to desktop doesn't
// also force a phone out of the mobile layout.
//
// This is a classic script rather than a module so the layout class lands
// before first paint and so faq.html, which loads no modules, gets it too.
// isMobileLayout() and uiScale() are deliberate globals for the same reason.
(function () {
    const PHONE_MAX_EDGE = 550; // CSS px: phones land near 400, the car near 780
    // Device px, unaffected by the density change: the car's panel short edge.
    const CAR_PANEL_MIN_SHORT = 1100;
    const CAR_PANEL_MAX_SHORT = 1450;
    const MIN_UI_SCALE = 0.5;   // floor on how far the undo may shrink the UI
    const OVERRIDE_KEY = 'layout-override';
    const SCALE_KEY = 'ui-scale-override';
    const ua = navigator.userAgent;

    function ratio() {
        return window.devicePixelRatio || 1;
    }

    function isTeslaUA() {
        return /Tesla\//i.test(ua) || /TESLA_AUTO/i.test(ua);
    }

    // A UA that names a desktop OS is not a car. Used only to refuse scaling,
    // never to grant it, so a car that stops matching this simply falls back to
    // the panel test rather than being mistaken for a laptop.
    function isDesktopOS() {
        return /Windows NT|Macintosh|CrOS/i.test(ua);
    }

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
        if (isTeslaUA()) {
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

    function readScaleOverride() {
        try {
            const param = new URLSearchParams(window.location.search).get('scale');
            if (param === 'auto') {
                localStorage.removeItem(SCALE_KEY);
            } else if (param !== null) {
                const asked = Number(param);
                if (asked >= MIN_UI_SCALE && asked <= 1) {
                    localStorage.setItem(SCALE_KEY, String(asked));
                }
            }
            const stored = Number(localStorage.getItem(SCALE_KEY));
            if (stored >= MIN_UI_SCALE && stored <= 1) {
                return stored;
            }
        } catch (e) {
            // Private mode or blocked storage: fall through to detection.
        }
        return null;
    }

    // True when devicePixelRatio reflects a page zoom applied over ordinary
    // pixels rather than a genuinely dense display, i.e. when the UI is bigger
    // than the design intends and shrinking it puts things back.
    function inflationReason(mobile) {
        if (mobile) {
            return null; // a phone's density is real, and it has its own scale
        }
        if (ratio() <= 1.05) {
            // An older car, still on the firmware that reported 1.0, is here.
            return null; // nothing to undo
        }
        if (isTeslaUA()) {
            return 'tesla-ua';
        }
        if (isDesktopOS()) {
            // A desktop at 125% chose that size; its panel can still land in
            // the band below, so this has to be refused before the panel test.
            return null;
        }
        const shortEdge = Math.min(screen.width || 0, screen.height || 0);
        const panelShortEdge = Math.round(shortEdge * ratio());
        if (panelShortEdge >= CAR_PANEL_MIN_SHORT
            && panelShortEdge <= CAR_PANEL_MAX_SHORT) {
            return 'car-panel';
        }
        return null;
    }

    function computeScale(mobile) {
        const override = readScaleOverride();
        if (override !== null) {
            return { scale: override, reason: 'override' };
        }
        const reason = inflationReason(mobile);
        if (reason === null) {
            return { scale: 1, reason: 'none' };
        }
        return {
            scale: Math.min(1, Math.max(MIN_UI_SCALE, 1 / ratio())),
            reason: reason
        };
    }

    const mobile = isMobileDevice();
    if (mobile) {
        document.documentElement.classList.add('mobile-device');
    }

    // Scaling is opt-in per device: without the class no zoom declaration
    // applies at all, so a browser that never inflated anything is untouched.
    const scaling = computeScale(mobile);
    if (scaling.scale !== 1) {
        document.documentElement.style.setProperty('--ui-scale', String(scaling.scale));
        document.documentElement.classList.add('ui-scaled');
    }

    // True when the narrow-screen layout is actually in effect. Must stay in
    // sync with the @media blocks gated on html.mobile-device.
    window.isMobileLayout = function () {
        return document.documentElement.classList.contains('mobile-device')
            && window.matchMedia('only screen and (max-width: 900px)').matches;
    };

    // The factor the UI is being shrunk by; 1 when nothing is being undone.
    window.uiScale = function () {
        return scaling.scale;
    };

    // Why that factor was chosen: 'tesla-ua', 'car-panel', 'override' or
    // 'none'. Surfaced in the debug section, since this can only be confirmed
    // from the car.
    window.uiScaleReason = function () {
        return scaling.reason;
    };
})();
