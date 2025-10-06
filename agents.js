// قائمة الوكلاء الثابتة (يمكن تعديل هذه البيانات مباشرة هنا)
const AGENTS_LIST = [{
        id: 'agent1_haydar',
        name: 'حيدره - ال جميل',
        governorate: 'كربلاء',
        account: '@H_9_40', // يجب أن يكون حساب تيليجرام
        channel: 'https://t.me/Topcash127',
        phone: '0770XXXXXXX'
    },
    {
        id: 'agent2_anas',
        name: 'انس',
        governorate: 'نينوى',
        account: '@AS_F32',
        channel: 'https://t.me/Topcash32',
        phone: '0781XXXXXXX'
    },
    {
        id: 'agent3_WLDAN',
        name: 'ولدان',
        governorate: 'صلاح الدين',
        account: '@W_N_2005',
        channel: 'https://t.me/Topcash120', // لا توجد قناة لهذا الوكيل
        phone: '0750XXXXXXX'
    },
    {
        id: 'agent4_mohameed',
        name: 'محمد خليل',
        governorate: 'الانبار',
        account: '@mhamadhalel',
        channel: 'https://t.me/mhamadaz123',
        phone: '0781XXXXXXX'
    },
    {
        id: 'agent5_om_narges',
        name: 'ام نرجس',
        governorate: 'النجف الاشرف',
        account: '@nnrrhhmm',
        channel: 'https://t.me/Topcash130',
        phone: '0781XXXXXXX'
    },
    {
        id: 'agent6_Fatema',
        name: 'فاطمة',
        governorate: 'كربلاء',
        account: '@Ffofa23',
        channel: 'https://t.me/Topcash03',
        phone: '0781XXXXXXX'
    }                 
                     
];

// دالة لعرض بيانات الوكلاء في واجهة المستخدم (مُحدَّثة لـ Tailwind Dark Mode)
function loadAgentsPageData() {
    const listElement = document.getElementById('agents-list');
    if (!listElement) return;

    listElement.innerHTML = '';

    AGENTS_LIST.forEach(agent => {
        // نستخدم الفئة card من الـ HTML لضمان تنسيق الداشبورد
        const agentDiv = document.createElement('div');
        agentDiv.className = 'agent-card card p-5 mb-4'; // استخدام فئة card

        // 1. رابط حساب التواصل (الوكيل) - Blue Button
        const contactLink = `
            <a href="https://t.me/${agent.account.replace('@', '')}" target="_blank"
                class="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-200 font-semibold text-sm">
                <i class="fa-brands fa-telegram-plane ml-2"></i> تواصل مع الوكيل
            </a>
        `;

        // 2. رابط قناة الوكيل - Green Button أو نص مُعلَّن
        const channelLink = agent.channel ?
            `
            <a href="${agent.channel}" target="_blank"
                class="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition duration-200 font-semibold text-sm">
                <i class="fa-solid fa-bullhorn ml-2"></i> قناة الوكيل (الأسعار)
            </a>
            ` :
            // تنسيق زر "لا توجد قناة" ليتناسب مع النمط الداكن
            `
            <span class="text-gray-400 bg-gray-700/50 py-2 px-4 rounded-lg text-sm font-medium">
                <i class="fa-solid fa-xmark-circle ml-2"></i> لا توجد قناة مُعلنة
            </span>
            `;

        agentDiv.innerHTML = `
            <h4 class="text-right pb-2 mb-2 text-xl font-bold">
                <i class="fa-solid fa-user-tag ml-2 text-primary"></i> الوكيل: ${agent.name}
            </h4>
            <p class="text-gray-400"><strong><i class="fa-solid fa-earth-africa ml-1 text-yellow-500"></i> المحافظة:</strong> ${agent.governorate}</p>
          
            
            <div class="agent-links flex flex-wrap justify-end gap-3 pt-3 mt-4 border-t border-gray-700">
                ${contactLink}
                ${channelLink}
            </div>
        `;
        listElement.appendChild(agentDiv);
    });
}

document.addEventListener('DOMContentLoaded', loadAgentsPageData);
// ======================================================
// الدالة الجديدة: منطق الأحكام والسياسات (Modal) (مُحدَّثة لـ Font Awesome و Tailwind)
// ======================================================

function setupTermsModal() {
    const termsBtn = document.getElementById('terms-btn');
    const modal = document.getElementById('terms-modal');
    const closeBtn = document.querySelector('.close-btn');
    const termsTextContainer = document.getElementById('terms-text');

    // 1. نص القوانين (مقسم إلى فقرات مع أيقونات Font Awesome)
    const rules = [{
            text: "**1. شراء النقاط:** ممنوع شراء النقاط من غير الوكلاء المدرجة أسماؤهم في البوت، والمخالفة تؤدي إلى **حظر الطرفين**.",
            icon: 'fa-solid fa-user-slash',
            type: 'bad'
        },
        {
            text: "**2. استلام النقاط:** يمنع استلام كميات كبيرة أو غير اعتيادية من حسابات وهمية أو حقيقية، وستؤدي المخالفة إلى **حظر الطرفين**.",
            icon: 'fa-solid fa-money-bill-transfer',
            type: 'bad'
        },
        {
            text: "**3. التحايل والانتحال:** أي محاولة للتحايل على الوكلاء أو قسم الدعم أو الانتحال كأحد أفراد الإدارة تؤدي إلى **الحظر الدائم**.",
            icon: 'fa-solid fa-skull-crossbones',
            type: 'bad'
        },
        {
            text: "**4. التعامل مع القروض:** إرسال أو استلام النقاط من أصحاب القروض يؤدي إلى **إنذارات وحظر أسبوعي**.",
            icon: 'fa-solid fa-sack-xmark',
            type: 'bad'
        },
        {
            text: "**5. المطورين والمشاريع الأخرى:** ممنوع استثمار أي دعم أو مشاريع لمطورين آخرين داخل البوت بأي شكل كان.",
            icon: 'fa-solid fa-code-branch',
            type: 'bad'
        },
        {
            text: "**6. التسقيط والإساءة:** أي محاولة تسقيط أو تشويه سمعة المستخدمين أو الإدارة تُعاقب بـ **الحظر الشهري أو السنوي**.",
            icon: 'fa-solid fa-vial-circle-check',
            type: 'bad'
        },
        {
            text: "**7. مسؤولية الحساب والأرباح:** المتجر غير مسؤول عن أي مشاكل تتعلق بحسابك في تيليجرام، وأرباح المتجر قابلة للصعود والنزول حسب طبيعة الاستثمار.",
            icon: 'fa-solid fa-circle-check',
            type: 'good'
        },
        {
            text: "**8. فترة السحب القصوى:** في حال لم يقم المستخدم بالسحب خلال مدة أقصاها **45 يوم**، يتم حظر الحساب بشكل تلقائي.",
            icon: 'fa-solid fa-clock-rotate-left',
            type: 'bad'
        }
    ];

    // تحويل النص إلى عناصر HTML <div class="rule-item"> مع فئات Tailwind
    termsTextContainer.innerHTML = rules.map(rule => {
        const baseClasses = "rule-item p-3 mb-3 rounded-lg border flex items-start text-sm";
        let specificClasses = "";

        if (rule.type === 'bad') {
            // تنسيق تنبيه خطر داكن
            specificClasses = "bg-red-900/30 border-red-700 text-red-300";
        } else if (rule.type === 'good') {
            // تنسيق تنبيه معلومات داكن
            specificClasses = "bg-green-900/30 border-green-700 text-green-300";
        }

        // استخدام Font Awesome وإزالة علامات ** من النص وتحويلها لـ <strong>
        return `
            <div class="${baseClasses} ${specificClasses}">
                <span class="rule-icon ml-3 text-lg mt-1"><i class="${rule.icon}"></i></span>
                <span class="rule-text font-medium">${rule.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</span>
            </div>
        `;
    }).join('');

    // 2. فتح الـ Modal (مُحدث لاستخدام فئات Tailwind)
    if (termsBtn) {
        termsBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        });
    }

    // 3. إغلاق الـ Modal عند النقر على (x)
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        });
    }

    // 4. إغلاق الـ Modal عند النقر خارج النافذة
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    });
}


// يجب التأكد من استدعاء دالة الأحكام في نهاية الـ DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // ... (الكود الأساسي الذي ربما يكون موجوداً هنا) ...

    // **استدعاء دالة الأحكام في نهاية الـ DOMContentLoaded**
    setupTermsModal();

    // ...

});
