document.addEventListener('DOMContentLoaded', function() {
    const enBtn = document.getElementById('en-btn');
    const hiBtn = document.getElementById('hi-btn');
    const enManual = document.getElementById('en-manual');
    const hiManual = document.getElementById('hi-manual');
    const colorClasses = ['color-intro', 'color-setup', 'color-guide', 'color-report', 'color-final'];

    // यह फंक्शन पेज लोड होते ही सभी सेक्शंस को एक-एक करके एनिमेट करेगा।
    // स्क्रॉल करने की ज़रूरत नहीं होगी।
    function animateSectionsOnLoad(manualElement) {
        const sections = manualElement.querySelectorAll('.manual-section');
        sections.forEach((section, index) => {
            // हर सेक्शन को एक रंग दें
            section.className = 'manual-section'; // पुरानी कलर क्लास हटाएँ
            section.classList.add(colorClasses[index % colorClasses.length]);

            // थोड़ी देर बाद 'is-visible' क्लास जोड़ें ताकि एनिमेशन दिखे
            setTimeout(() => {
                section.classList.add('is-visible');
            }, index * 150); // 150ms की देरी से अगला सेक्शन आएगा
        });
    }

    // भाषा बदलने वाला मुख्य फंक्शन
    function showManual(lang) {
        // बटन की स्थिति अपडेट करें
        enBtn.classList.toggle('active', lang === 'en');
        hiBtn.classList.toggle('active', lang === 'hi');

        // मैन्युअल दिखाएँ/छिपाएँ
        enManual.classList.toggle('active', lang === 'en');
        hiManual.classList.toggle('active', lang === 'hi');
        
        // जो मैन्युअल अभी दिखाया गया है, उसके सेक्शन पर एनिमेशन चलाएँ
        if (lang === 'en') {
            animateSectionsOnLoad(enManual);
        } else {
            animateSectionsOnLoad(hiManual);
        }
    }

    // बटनों पर क्लिक इवेंट
    enBtn.addEventListener('click', () => showManual('en'));
    hiBtn.addEventListener('click', () => showManual('hi'));

    // पेज लोड होने पर डिफ़ॉल्ट भाषा (English) दिखाएँ और एनिमेशन शुरू करें
    showManual('en');
});
