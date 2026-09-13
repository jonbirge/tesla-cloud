// Device form-factor detection.
//
// Viewport width alone can no longer identify a phone. Tesla's 2026.26 update
// raised the in-car browser's device pixel ratio from 1.0 to 1.53, cutting the
// reported CSS width by about a third and pulling the car below the 900px
// mobile breakpoint. The browser still self-identifies with a Tesla/ token and
// reports userAgentData.mobile === false, so key off form factor instead and
// treat width only as a secondary condition.
//
// This is a classic script rather than a module so the layout class lands
// before first paint and so faq.html, which loads no modules, gets it too.
// isMobileLayout() is a deliberate global for the same reason.
(function () {
    const ua = navigator.userAgent;

    function isMobileDevice() {
        if (/Tesla\//i.test(ua)) {
            return false;
        }
        if (navigator.userAgentData) {
            return navigator.userAgentData.mobile;
        }
        // iPadOS 13+ reports a desktop Macintosh UA; touch points disambiguate.
        if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
            return true;
        }
        return /Android|iPhone|iPod|IEMobile|Opera Mini/i.test(ua);
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
