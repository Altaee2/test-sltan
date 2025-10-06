// A. استيراد وظائف Firebase المطلوبة
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateEmail as firebaseUpdateEmail } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, arrayUnion, query, collection, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// ======================================================
// ** D0. بيانات المطور والتهيئة — تُحمّل من info.json **
// ======================================================
// سيتم تعيينهم عند تحميل info.json
let DEV_EMAIL = null;
let DEV_PASSWORD = null;
let DEV_TOKEN_KEY = null;    // سيُقرأ من info.json
let DEV_TOKEN_VALUE = null;  // سيُقرأ من info.json

// المتغير الخاص بتكوين Firebase سيُقرأ من info.json
let firebaseConfig = null;

// تهيئة التطبيق وخدماته سيتم تنفيذها بعد تحميل config
let app = null;
let auth = null;
let db = null;

// دالة تحميل بيانات المطور و Firebase Config من ملف info.json
async function loadConfig() {
    try {
        const response = await fetch('info.json');
        if (!response.ok) {
            console.error("Warning: Could not load info.json. Using fallback or blocking admin access.");
            return false;
        }
        const config = await response.json();

        // تحديث بيانات المطور
        DEV_EMAIL = config.DEV_EMAIL ?? null;
        DEV_PASSWORD = config.DEV_PASSWORD ?? null;

        // تحميل مفاتيح الجلسة الإدارية إن وجدت
        DEV_TOKEN_KEY = config.DEV_TOKEN_KEY ?? "DEV_ACCESS_TOKEN";
        DEV_TOKEN_VALUE = config.DEV_TOKEN_VALUE ?? "DEV_TOKEN_VALUE_PLACEHOLDER";

        // تحميل firebaseConfig إذا وُجد
        if (config.firebaseConfig) {
            firebaseConfig = config.firebaseConfig;
        } else {
            console.error("No firebaseConfig found in info.json");
            return false;
        }

        console.log("Configuration loaded successfully from info.json.");
        return true;
    } catch (error) {
        console.error("Error parsing info.json or loading config:", error);
        return false;
    }
}


// ======================================================
// D. إعدادات النظام
// ======================================================
const DAILY_GIFT_AMOUNT = 50;
const COUNTER_INCREMENT = 0;
const COOLDOWN_TIME_MS = 24 * 60 * 60 * 1000;
const REFERRAL_BONUS = 50; // مكافأة صاحب كود الإحالة
const TRANSFER_FEE = 5000; // 👈 عمولة تحويل النقاط

// قائمة العدادات القابلة للشراء
const BOOST_ITEMS = [
    { id: 'boost100', name: 'عداد نقاط +100', value: 100, price: 16000 },
    { id: 'boost250', name: 'عداد نقاط +250', value: 250, price: 40000 },
    { id: 'boost500', name: 'عداد نقاط +500', value: 500, price: 80000 },
    { id: 'boost1000', name: 'عداد نقاط +1000', value: 1000, price: 158000 },
    { id: 'boost2500', name: 'عداد نقاط +2500', value: 2500, price: 395000 },
    { id: 'boost5000', name: 'عداد نقاط +5000', value: 5000, price: 775000 },
    { id: 'boost10000', name: 'عداد نقاط +10000', value: 10000, price: 1540000 },
    { id: 'boost25000', name: 'عداد نقاط +25000', value: 25000, price: 3825000 },
    { id: 'boost50000', name: 'عداد نقاط +50000', value: 50000, price: 7500000 },
];

// متغيرات لحفظ عدادات التنازلي
let giftCountdownInterval = null;
let counterCountdownInterval = null;


// ======================================================
// 1. دوال المساعدة الأساسية
// ======================================================

// دالة توليد رقم معرف فريد للمستخدم (يتكون من 10 أرقام)
function generateNumericUserId() {
    const timestampPart = Math.floor(Date.now() / 1000).toString().slice(-6);
    const randomPart = Math.floor(Math.random() * 9000) + 1000;
    return parseInt(timestampPart + randomPart.toString());
}

// دالة توليد كود إحالة عشوائي (8 خانات أحرف وأرقام إنجليزية)
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// دالة لعرض رسالة 
function displayMessage(msg, type = 'success') {
    const messageElement = document.getElementById('message');
    const isAdminPage = window.location.pathname.endsWith('admin.html') || window.location.pathname.endsWith('admin-login.html');
    const targetElement = isAdminPage && document.getElementById('admin-message') ? document.getElementById('admin-message') : messageElement;

    if (!targetElement) return;

    targetElement.innerHTML = msg; // تم التعديل إلى innerHTML لدعم تنسيق الرسائل الأغنى
    if (type === 'success') {
        targetElement.classList.remove('bg-red-100', 'text-red-800', 'bg-blue-100', 'text-blue-800');
        targetElement.classList.add('bg-green-100', 'text-green-800');
        targetElement.style.backgroundColor = '#d4edda';
        targetElement.style.color = '#155724';
    } else if (type === 'error') {
        targetElement.classList.remove('bg-green-100', 'text-green-800', 'bg-blue-100', 'text-blue-800');
        targetElement.classList.add('bg-red-100', 'text-red-800');
        targetElement.style.backgroundColor = '#f8d7da';
        targetElement.style.color = '#721c24';
    } else {
        targetElement.classList.remove('bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800');
        targetElement.classList.add('bg-blue-100', 'text-blue-800');
        targetElement.style.backgroundColor = '#cfe2ff';
        targetElement.style.color = '#084298';
    }

    targetElement.style.display = 'block';
    setTimeout(() => {
        targetElement.style.display = 'none';
    }, 5000);
}

// دالة إعادة التوجيه
function redirectTo(path) {
    window.location.href = path;
}

// ======================================================
// 2. منطق المصادقة (Auth Logic)
// ======================================================

// البحث عن كود الإحالة للمكافأة
async function getReferrerByCode(code) {
    if (!code) return { referrerUid: null, referrerDocRef: null, referrerUsername: null };

    // تأكد من أن الكود مكون من 8 أحرف وأرقام إنجليزية
    const formattedCode = code.toUpperCase().trim();
    if (formattedCode.length !== 8) return { referrerUid: null, referrerDocRef: null, referrerUsername: null };

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("referral_code", "==", formattedCode));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { referrerUid: doc.id, referrerDocRef: doc.ref, referrerUsername: doc.data().username || 'مستخدم غير معروف' };
        }
    } catch (error) {
        console.error("Error finding referrer by code:", error);
    }
    return { referrerUid: null, referrerDocRef: null, referrerUsername: null };
}


// منطق إنشاء الحساب (Register)
async function handleRegistration(e) {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;
    const referralCode = document.getElementById('referral-code').value; // جلب كود الإحالة المدخل

    if (password !== confirmPassword) {
        displayMessage('كلمتا السر غير متطابقتين!', 'error');
        return;
    }

    try {
        // 1. توليد كود إحالة فريد للمستخدم الجديد
        let newReferralCode;
        let codeExists = true;
        while (codeExists) {
            newReferralCode = generateReferralCode();
            const check = await getReferrerByCode(newReferralCode);
            if (!check.referrerUid) {
                codeExists = false;
            }
        }

        // 2. إنشاء حساب Firebase
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const numericId = generateNumericUserId();

        // 3. التحقق من كود الإحالة المدخل وتطبيق المكافأة (باستخدام Transaction لضمان الأمان)
        const referrerData = await getReferrerByCode(referralCode);

        if (referrerData.referrerUid) {
            // تم استخدام كود إحالة صحيح

            await runTransaction(db, async(transaction) => {
                const referrerDoc = await transaction.get(referrerData.referrerDocRef);

                if (!referrerDoc.exists) {
                    throw "Referrer Document does not exist!";
                }

                // تحديث بيانات صاحب كود الإحالة
                const newReferrerPoints = referrerDoc.data().points + REFERRAL_BONUS;
                // تحديث عدد المدعوين
                const newInvitedCount = (referrerDoc.data().invited_count || 0) + 1;

                transaction.update(referrerData.referrerDocRef, {
                    points: newReferrerPoints,
                    referral_earnings: increment(REFERRAL_BONUS),
                    invited_count: newInvitedCount // تحديث عدد المدعوين
                });

                // إنشاء وثيقة المستخدم الجديد
                transaction.set(doc(db, "users", user.uid), {
                    username: username,
                    email: email,
                    numeric_user_id: numericId,
                    points: 0,
                    counter_quantity: 0,
                    last_claimed_date: null,
                    last_counter_claim: null,
                    purchase_history: [],
                    is_banned: false,
                    isAdmin: false,
                    referral_code: newReferralCode, // كود الإحالة الخاص به
                    referred_by_uid: referrerData.referrerUid, // UID الذي قام بإحالته
                    referred_by_username: referrerData.referrerUsername, // اسم الداعي
                    referral_earnings: 0,
                    invited_count: 0, // عدد المدعوين لهذا المستخدم الجديد
                    createdAt: new Date()
                });
            });

            displayMessage(`✅ تم إنشاء الحساب بنجاح! صاحب كود الإحالة (${referralCode}) حصل على ${REFERRAL_BONUS} نقطة.`);

        } else {
            // لا يوجد كود إحالة أو الكود غير صحيح
            await setDoc(doc(db, "users", user.uid), {
                username: username,
                email: email,
                numeric_user_id: numericId,
                points: 0,
                counter_quantity: 0,
                last_claimed_date: null,
                last_counter_claim: null,
                purchase_history: [],
                is_banned: false,
                isAdmin: false,
                referral_code: newReferralCode, // كود الإحالة الخاص به
                referred_by_uid: null, // لم تتم الإحالة عن طريق أحد
                referred_by_username: null,
                referral_earnings: 0, // ربح الإحالة
                invited_count: 0,
                createdAt: new Date()
            });
            displayMessage('✅ تم إنشاء الحساب بنجاح!');
        }


        setTimeout(() => { redirectTo('index.html'); }, 2000);

    } catch (error) {
        console.error("خطأ في إنشاء الحساب:", error.code, error.message);
        let errorMessage = 'حدث خطأ غير متوقع.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'هذا البريد الإلكتروني مستخدم بالفعل.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'صيغة البريد الإلكتروني غير صحيحة.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'كلمة السر ضعيفة جداً (يجب أن تكون 6 أحرف على الأقل).';
        } else if (typeof error === 'string') {
            errorMessage = error; // خطأ من الترانزاكشن
        }
        displayMessage(`❌ خطأ: ${errorMessage}`, 'error');
    }
}

// منطق تسجيل الدخول للمستخدم العادي
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('password').value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const docSnap = await getDoc(doc(db, "users", user.uid));

        if (docSnap.exists()) {
            const userData = docSnap.data();

            if (userData.is_banned) {
                await signOut(auth);
                displayMessage('❌ تم تجميد حسابك. يرجى التواصل مع الدعم.', 'error');
                return;
            }

            if (userData.isAdmin) {
                await signOut(auth);
                displayMessage('❌ هذا الحساب هو حساب مطور. يرجى تسجيل الدخول من صفحة المطورين.', 'error');
                return;
            }
        }

        displayMessage('مرحباً بك! تم تسجيل الدخول بنجاح.', 'success');
        setTimeout(() => { redirectTo('dashboard.html'); }, 1500);

    } catch (error) {
        console.error("خطأ في تسجيل الدخول:", error.code, error.message);
        let errorMessage = 'حدث خطأ في تسجيل الدخول.';
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            errorMessage = 'البريد الإلكتروني أو كلمة السر غير صحيحة.';
        }
        displayMessage(`❌ خطأ: ${errorMessage}`, 'error');
    }
}


// ======================================================
// 3. منطق لوحة تحكم المطور (Admin Panel Logic)
// ======================================================

// التحقق من صلاحيات المطور والدخول (تحقق داخلي ثابت)
function handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;

    // التأكد من تحميل البيانات بنجاح
    if (DEV_EMAIL === null || DEV_PASSWORD === null) {
        displayMessage('❌ فشل تحميل بيانات المطور. حاول تحديث الصفحة.', 'error');
        return;
    }

    if (email === DEV_EMAIL && password === DEV_PASSWORD) {
        sessionStorage.setItem(DEV_TOKEN_KEY, DEV_TOKEN_VALUE);
        displayMessage('✅ تم تسجيل دخول المطور بنجاح.');
        redirectTo('admin.html');
    } else {
        displayMessage('❌ بيانات الدخول الإدارية غير صحيحة.', 'error');
    }
}

// دالة التحقق من الرمز السري للمطور
function isAuthenticatedAdmin() {
    return sessionStorage.getItem(DEV_TOKEN_KEY) === DEV_TOKEN_VALUE;
}

// البحث عن المستخدم باستخدام الـ ID الرقمي (للمطور)
async function findUserByNumericId(numericIdString) {
    const adminMessage = document.getElementById('admin-message');
    if (adminMessage) {
        displayMessage('جارٍ البحث...', 'info');
    }

    try {
        const numericId = parseInt(numericIdString, 10);

        if (isNaN(numericId) || numericId <= 0) {
            if (adminMessage) displayMessage('❌ المعرّف المدخل غير صالح أو ليس رقماً.', 'error');
            return null;
        }

        const usersRef = collection(db, "users");
        const q = query(usersRef, where("numeric_user_id", "==", numericId));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            if (adminMessage) displayMessage('❌ لم يتم العثور على مستخدم بهذا المعرّف.', 'error');
            return null;
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        userData.uid = userDoc.id; // إضافة UID الخاص بـ Firebase للرجوع إليه
        if (adminMessage) displayMessage('✅ تم العثور على المستخدم بنجاح.', 'success');
        return userData;

    } catch (error) {
        console.error("خطأ في البحث عن المستخدم:", error);
        if (adminMessage) displayMessage('❌ فشلت عملية البحث (تحقق من الاتصال أو تأكد من وجود فهرس لهذا الحقل في قاعدة البيانات).', 'error');
        return null;
    }
}

// دالة تنفيذ الإجراءات الإدارية
async function executeAdminAction(targetUserUid, actionType, value) {
    const userDocRef = doc(db, "users", targetUserUid);
    let successMessage = '✅ تم تنفيذ الإجراء بنجاح.';

    displayMessage('جارٍ تنفيذ الإجراء...');

    try {
        switch (actionType) {
            case 'updateEmail':
                // ملاحظة: تحديث البريد الإلكتروني في Firestore لا يغيره في Firebase Auth.
                // يجب استخدام دالة updateEmail من Firebase Auth إذا أردت تحديث الحساب الفعلي.
                await updateDoc(userDocRef, { email: value });
                successMessage = `✅ تم تحديث البريد الإلكتروني في Firestore إلى: ${value}.`;
                break;
            case 'addPoints':
            case 'subtractPoints':
                const pointsChange = actionType === 'addPoints' ? value : -value;
                await updateDoc(userDocRef, { points: increment(pointsChange) });
                successMessage = actionType === 'addPoints' ?
                    `✅ تم إضافة ${value} نقطة بنجاح.` :
                    `✅ تم خصم ${value} نقطة بنجاح.`;
                break;
            case 'addCounter':
            case 'subtractCounter':
                const counterChange = actionType === 'addCounter' ? value : -value;
                await updateDoc(userDocRef, { counter_quantity: increment(counterChange) });
                successMessage = actionType === 'addCounter' ?
                    `✅ تم إضافة ${value} للعداد بنجاح.` :
                    `✅ تم خصم ${value} من العداد بنجاح.`;
                break;
            case 'banAccount':
                await updateDoc(userDocRef, { is_banned: true });
                successMessage = '❌ تم تجميد الحساب بنجاح.';
                break;
            case 'unbanAccount':
                await updateDoc(userDocRef, { is_banned: false });
                successMessage = '✅ تم إلغاء تجميد الحساب بنجاح.';
                break;
            default:
                throw new Error("نوع الإجراء غير معروف.");
        }

        displayMessage(successMessage, 'success');
        return await findUserByNumericId(document.getElementById('search-id').value);

    } catch (error) {
        console.error("خطأ في تنفيذ الإجراء:", error);
        displayMessage(`❌ فشل تنفيذ الإجراء: ${error.message}`, 'error');
        return null;
    }
}

// دالة تحميل واجهة المطور
function setupAdminPanel() {
    const adminPanel = document.getElementById('adminPanel');
    if (!adminPanel) return;

    if (!isAuthenticatedAdmin()) {
        redirectTo('admin-login.html');
        return;
    }

    let targetUserUid = null;

    const searchForm = document.getElementById('search-form');
    const actionForm = document.getElementById('action-form');
    const userDataDisplay = document.getElementById('user-data-display');

    searchForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        const numericId = document.getElementById('search-id').value;

        if (!numericId || isNaN(parseInt(numericId, 10))) {
            displayMessage('❌ الرجاء إدخال ID رقمي صالح.', 'error');
            return;
        }

        const userData = await findUserByNumericId(numericId);

        if (userData) {
            targetUserUid = userData.uid;
            // عرض بيانات المستخدم في الواجهة
            userDataDisplay.innerHTML = `
                <h4 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-2">بيانات المستخدم المستهدف</h4>
                <p><strong>UID (فايربيس):</strong> ${userData.uid}</p>
                <p><strong>ID الرقمي:</strong> <span class="text-green-600 font-bold">${userData.numeric_user_id}</span></p>
                <p><strong>البريد الإلكتروني:</strong> ${userData.email}</p>
                <p><strong>اسم المستخدم:</strong> ${userData.username}</p>
                <p><strong>النقاط:</strong> <span id="display-points" class="font-bold">${userData.points}</span></p>
                <p><strong>كمية العداد:</strong> <span id="display-counter" class="font-bold">${userData.counter_quantity}</span></p>
                <p><strong>كود الإحالة:</strong> <span class="font-bold text-blue-600">${userData.referral_code || 'غير متوفر'}</span></p>
                <p><strong>أرباح الإحالة:</strong> <span class="font-bold text-orange-600">${userData.referral_earnings !== undefined ? userData.referral_earnings : 0} نقطة</span></p>
                <p><strong>عدد المدعوين:</strong> <span class="font-bold text-green-600">${userData.invited_count !== undefined ? userData.invited_count : 0}</span></p>
                <p><strong>حالة الحساب:</strong> <span id="display-status" class="font-bold ${userData.is_banned ? 'text-red-600' : 'text-green-600'}">${userData.is_banned ? 'مُجَمَّد' : 'نشط'}</span></p>
            `;
            actionForm.style.display = 'block';
        } else {
            userDataDisplay.innerHTML = '<p>قم بالبحث عن مستخدم باستخدام الـ ID الرقمي أعلاه.</p>';
            actionForm.style.display = 'none';
            targetUserUid = null;
        }
    });

    actionForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        if (!targetUserUid) {
            displayMessage('❌ الرجاء البحث عن مستخدم أولاً.', 'error');
            return;
        }

        const actionType = document.getElementById('action-type').value;
        let value = document.getElementById('action-value').value;

        if (['addPoints', 'subtractPoints', 'addCounter', 'subtractCounter'].includes(actionType)) {
            value = parseInt(value, 10);
            if (isNaN(value) || value <= 0) {
                displayMessage('❌ القيمة يجب أن تكون رقماً موجباً.', 'error');
                return;
            }
        } else if (actionType === 'updateEmail') {
            if (!value || !value.includes('@') || !value.includes('.')) {
                displayMessage('❌ الرجاء إدخال بريد إلكتروني صحيح.', 'error');
                return;
            }
        } else if (['banAccount', 'unbanAccount'].includes(actionType)) {
            value = null;
        } else if (!actionType) {
            displayMessage('❌ الرجاء اختيار نوع الإجراء.', 'error');
            return;
        }


        const updatedUserData = await executeAdminAction(targetUserUid, actionType, value);

        if (updatedUserData) {
            document.getElementById('display-points').textContent = updatedUserData.points;
            document.getElementById('display-counter').textContent = updatedUserData.counter_quantity;
            const statusSpan = document.getElementById('display-status');
            statusSpan.textContent = updatedUserData.is_banned ? 'مُجَمَّد' : 'نشط';
            statusSpan.className = `font-bold ${updatedUserData.is_banned ? 'text-red-600' : 'text-green-600'}`;
        }
    });

    document.getElementById('action-type').addEventListener('change', (e) => {
        const valueInputGroup = document.getElementById('action-value-group');
        const actionType = e.target.value;
        const actionValueInput = document.getElementById('action-value');

        if (['addPoints', 'subtractPoints', 'addCounter', 'subtractCounter', 'updateEmail'].includes(actionType)) {
            valueInputGroup.style.display = 'block';
            actionValueInput.type = actionType === 'updateEmail' ? 'email' : 'number';
            actionValueInput.placeholder = actionType === 'updateEmail' ? 'البريد الإلكتروني الجديد' : 'القيمة (رقم)';
            actionValueInput.required = true;
        } else {
            valueInputGroup.style.display = 'none';
            actionValueInput.value = '';
            actionValueInput.required = false;
        }
    });

    document.getElementById('action-type').dispatchEvent(new Event('change'));
}


// ======================================================
// 4. منطق الداشبورد (Dashboard Logic)
// ======================================================

// دالة المطالبة بالهدية اليومية 
async function claimDailyGift(user, giftBtn) {
    try {
        const userDocRef = doc(db, "users", user.uid);
        giftBtn.disabled = true;
        document.getElementById('gift-text').textContent = 'جارٍ المطالبة...';

        await updateDoc(userDocRef, {
            points: increment(DAILY_GIFT_AMOUNT),
            last_claimed_date: Date.now()
        });

        await loadDashboardData(user, true);
        displayMessage(`🎉 تهانينا! لقد حصلت على ${DAILY_GIFT_AMOUNT} نقطة.`, 'success');

    } catch (error) {
        console.error("خطأ في المطالبة بالهدية:", error);
        displayMessage('❌ فشل المطالبة بالهدية اليومية.', 'error');
        giftBtn.disabled = false;
        document.getElementById('gift-text').textContent = 'حدث خطأ. حاول مجدداً.';
    }
}

// دالة التحقق من حالة الهدية وعرض العداد التنازلي 
function checkAndDisplayDailyGiftStatus(userData, user) {
    const giftBtn = document.getElementById('daily-gift-btn');
    const giftText = document.getElementById('gift-text');
    const timerElement = document.getElementById('countdown-timer');

    if (!giftBtn || !timerElement) return;

    if (giftCountdownInterval) {
        clearInterval(giftCountdownInterval);
        giftCountdownInterval = null;
    }

    const lastClaimed = userData.last_claimed_date || 0;
    const now = Date.now();
    const nextClaimTime = lastClaimed + COOLDOWN_TIME_MS;
    const timeRemaining = nextClaimTime - now;

    if (timeRemaining <= 0) {
        giftBtn.disabled = false;
        giftText.textContent = `اضغط للمطالبة بـ ${DAILY_GIFT_AMOUNT} نقطة!`;
        timerElement.textContent = 'الهدية جاهزة الآن.';

        if (!giftBtn.hasListener) {
            giftBtn.addEventListener('click', () => claimDailyGift(user, giftBtn));
            giftBtn.hasListener = true;
        }

    } else {
        giftBtn.disabled = true;
        giftText.textContent = 'الرجاء الانتظار...';

        const updateTimer = () => {
            const currentRemaining = nextClaimTime - Date.now();
            if (currentRemaining <= 1000) {
                clearInterval(giftCountdownInterval);
                checkAndDisplayDailyGiftStatus(userData, user);
                return;
            }

            const totalSeconds = Math.floor(currentRemaining / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            timerElement.textContent = `الوقت المتبقي: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        updateTimer();
        giftCountdownInterval = setInterval(updateTimer, 1000);
    }
}


// دالة زيادة العداد التلقائي
// ✅ دالة الزيادة اليدوية للعداد
async function claimManualCounterBoost(user, counterQuantity, btn) {
    try {
        const userDocRef = doc(db, "users", user.uid);
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-hourglass-half mr-2"></i> جارٍ التنفيذ...';

        // تحديث البيانات في Firestore
        await updateDoc(userDocRef, {
            points: increment(counterQuantity),
            last_counter_claim: Date.now()
        });

        // جلب البيانات من السيرفر بعد التحديث
        const updatedDoc = await getDoc(userDocRef);
        const updatedPoints = updatedDoc.exists() ? updatedDoc.data().points : 0;

        displayMessage(`🎉 تمت إضافة ${counterQuantity} نقطة إلى رصيدك!<br>💰 رصيدك الحالي الآن: ${updatedPoints} نقطة.`, 'success');
        await loadDashboardData(user, true);
    } catch (error) {
        console.error("خطأ في زيادة العداد اليدوية:", error);
        displayMessage('❌ فشل تنفيذ العملية. حاول مجددًا.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i> زيادة العداد الآن';
    }
}

// ✅ دالة فحص حالة العداد اليدوي (تُعرض الزر أو الوقت)
function checkAndDisplayCounterStatus(userData, user) {
    const timerElement = document.getElementById('counter-timer');
    const manualBtn = document.getElementById('manual-counter-btn');
    if (!timerElement || !manualBtn) return;

    if (counterCountdownInterval) {
        clearInterval(counterCountdownInterval);
        counterCountdownInterval = null;
    }

    const counterQuantity = userData.counter_quantity || 0;
    const lastClaimed = userData.last_counter_claim || 0;
    const now = Date.now();
    const nextClaimTime = lastClaimed + COOLDOWN_TIME_MS;
    const timeRemaining = nextClaimTime - now;

    // إذا المستخدم ما عنده عداد
    if (counterQuantity <= 0) {
        manualBtn.style.display = 'none';
        timerElement.textContent = 'ليس لديك عداد لتفعيله حالياً.';
        return;
    }

    if (timeRemaining <= 0) {
        // جاهز للتفعيل اليدوي
        manualBtn.style.display = 'flex';
        timerElement.textContent = 'العداد جاهز للتفعيل الآن.';
        manualBtn.disabled = false;
        manualBtn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i> زيادة العداد الآن';

        if (!manualBtn.hasListener) {
            manualBtn.addEventListener('click', () => {
                claimManualCounterBoost(user, counterQuantity, manualBtn);
            });
            manualBtn.hasListener = true;
        }
    } else {
        // قيد الانتظار (عرض العد التنازلي)
        manualBtn.style.display = 'none';

        const updateTimer = () => {
            const currentRemaining = nextClaimTime - Date.now();
            if (currentRemaining <= 0) {
                clearInterval(counterCountdownInterval);
                checkAndDisplayCounterStatus(userData, user);
                return;
            }

            const totalSeconds = Math.floor(currentRemaining / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            timerElement.textContent =
                `⏳ الوقت المتبقي: ${hours.toString().padStart(2, '0')}:${minutes
                    .toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        updateTimer();
        counterCountdownInterval = setInterval(updateTimer, 1000);
    }
}

// دالة عرض كود الإحالة للمستخدم (تم الإبقاء عليها للاستخدام كـ Modal أو رسالة)
function displayReferralCodeMessage(userData) {
    const code = userData.referral_code || 'N/A';
    const earnings = userData.referral_earnings !== undefined ? userData.referral_earnings : 0;

    const message = `
        <span class="font-bold">كود الإحالة الخاص بك:</span> 
        <span class="text-blue-600 font-extrabold text-xl">${code}</span>
        <br>
        شارك الكود مع أصدقائك وكسب ${REFERRAL_BONUS} نقطة لكل شخص ينضم!
        <br>
        (مجموع أرباح الإحالة: ${earnings} نقطة)
    `;

    displayMessage(message, 'info');
}


// دالة تحميل بيانات الداشبورد (تم تحديثها لحل مشكلة "تحميل...")
async function loadDashboardData(user, forceReload = false) {
    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef, { source: forceReload ? 'server' : 'default' });

    if (docSnap.exists()) {
        const userData = docSnap.data();

        if (userData.is_banned || userData.isAdmin) {
            await signOut(auth);
            redirectTo(userData.isAdmin ? 'admin-login.html' : 'index.html');
            displayMessage('❌ لا يمكن الوصول.', 'error');
            return;
        }

        // تحديث واجهة المستخدم
        const accountNameElement = document.getElementById('account-name');
        const pointsCountElement = document.getElementById('points-count');
        const counterQuantityElement = document.getElementById('counter-quantity');
        const userIdElement = document.getElementById('numeric-user-id');
        const referralCodeElement = document.getElementById('referral-code');
        const referrerNameElement = document.getElementById('referrer-name');
        const invitedCountElement = document.getElementById('invited-count');

        if (accountNameElement) accountNameElement.textContent = userData.username || 'المستخدم';
        if (pointsCountElement) pointsCountElement.textContent = userData.points !== undefined ? userData.points.toLocaleString('en-US') : '0';
        if (counterQuantityElement) counterQuantityElement.textContent = userData.counter_quantity !== undefined ? userData.counter_quantity.toLocaleString('en-US') : '0';
        if (userIdElement) userIdElement.textContent = userData.numeric_user_id !== undefined ? userData.numeric_user_id.toString() : 'N/A';

        if (referralCodeElement) {
            referralCodeElement.textContent = userData.referral_code || 'N/A';
        }

        if (referrerNameElement) {
            referrerNameElement.textContent = userData.referred_by_username || 'لا يوجد';
        }

        if (invitedCountElement) {
            invitedCountElement.textContent = (userData.invited_count !== undefined ? userData.invited_count : 0).toString();
        }

        // تشغيل عدادات التنازلي والتحقق من الحالة
        checkAndDisplayDailyGiftStatus(userData, user);
        checkAndDisplayCounterStatus(userData, user);

    } else {
        console.warn("لم يتم العثور على بيانات المستخدم في Firestore.");
        const accountNameElement = document.getElementById('account-name');
        if (accountNameElement) accountNameElement.textContent = 'خطأ في جلب البيانات';
    }
}


// ======================================================
// 4.1 منطق تحويل النقاط (Transfer Points Logic)
// ======================================================

// دالة البحث عن المستخدم باستخدام الـ ID الرقمي (لتحويل النقاط)
async function findUserByNumericIdForTransfer(numericId) {
    if (isNaN(numericId) || numericId <= 0) {
        displayMessage('❌ المعرّف المدخل غير صالح.', 'error');
        return null;
    }

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("numeric_user_id", "==", numericId));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            displayMessage('❌ لم يتم العثور على مستخدم بهذا المعرّف.', 'error');
            return null;
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        userData.uid = userDoc.id; // إضافة UID للمستلم

        // التحقق من أن المستخدم ليس هو نفسه المرسل
        const sender = auth.currentUser;
        if (sender && sender.uid === userData.uid) {
            displayMessage('❌ لا يمكنك التحويل لنفسك.', 'error');
            return null;
        }

        displayMessage('✅ تم العثور على المستلم بنجاح.', 'success');
        return userData;

    } catch (error) {
        console.error("خطأ في البحث عن المستلم:", error);
        displayMessage('❌ فشلت عملية البحث.', 'error');
        return null;
    }
}

// دالة التحويل الآمنة للنقاط باستخدام Transaction
async function executePointTransfer(senderUid, recipientUid, transferAmount) {
    const senderDocRef = doc(db, "users", senderUid);
    const recipientDocRef = doc(db, "users", recipientUid);
    const totalDeduction = transferAmount + TRANSFER_FEE;

    // يجب أن يكون المبلغ المحول أكبر من صفر وأن يكون المبلغ الإجمالي أكبر من أو يساوي العمولة
    if (transferAmount <= 0) {
        displayMessage('❌ يجب تحويل نقطة واحدة على الأقل.', 'error');
        return false;
    }

    if (totalDeduction <= 0) {
        displayMessage('❌ المبلغ الإجمالي (مع العمولة) يجب أن يكون موجباً.', 'error');
        return false;
    }


    try {
        await runTransaction(db, async(transaction) => {
            const senderDoc = await transaction.get(senderDocRef);
            const recipientDoc = await transaction.get(recipientDocRef);

            // 1. تحقق من وجود وثيقتي المرسل والمستلم
            if (!senderDoc.exists() || !recipientDoc.exists()) {
                throw "Sender or Recipient document does not exist!";
            }

            const senderPoints = senderDoc.data().points || 0;
            const recipientPoints = recipientDoc.data().points || 0;

            // 2. التحقق من رصيد المرسل (الرصيد يجب أن يغطي المبلغ + العمولة)
            if (senderPoints < totalDeduction) {
                throw `رصيدك (${senderPoints.toLocaleString()}) غير كافٍ لإجراء التحويل. أنت تحتاج لـ ${totalDeduction.toLocaleString()} نقطة (يشمل العمولة ${TRANSFER_FEE.toLocaleString()} نقطة).`;
            }

            // 3. تنفيذ التحويل

            // خصم النقاط المحولة + العمولة من المرسل
            const newSenderPoints = senderPoints - totalDeduction;
            transaction.update(senderDocRef, {
                points: newSenderPoints,
                // يمكنك إضافة سجل تحويل هنا إذا أردت
            });

            // إضافة النقاط المحولة فقط إلى المستلم
            const newRecipientPoints = recipientPoints + transferAmount;
            transaction.update(recipientDocRef, {
                points: newRecipientPoints,
                // يمكنك إضافة سجل تحويل هنا إذا أردت
            });
        });

        displayMessage(`✅ تم التحويل بنجاح! تم إرسال ${transferAmount.toLocaleString()} نقطة، وخصم عمولة ${TRANSFER_FEE.toLocaleString()} نقطة.`, 'success');
        return true;

    } catch (error) {
        console.error("خطأ في الترانزاكشن (تحويل النقاط):", error);
        // عرض الخطأ للمستخدم إذا كان خطأ تحقق (مثل عدم كفاية الرصيد)
        if (typeof error === 'string') {
            displayMessage(`❌ فشل التحويل: ${error}`, 'error');
        } else {
            displayMessage('❌ فشلت عملية التحويل الآمنة. حاول مجدداً.', 'error');
        }
        return false;
    }
}


// ======================================================
// 5. منطق المتجر (Boosts Logic) 
// ======================================================
// منطق الشراء من المتجر
async function handlePurchase(user, item) {
    const userDocRef = doc(db, "users", user.uid);
    let userData;

    try {
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
            userData = docSnap.data();
        } else {
            // استخدام أيقونة Font Awesome
            displayMessage('<i class="fa-solid fa-circle-xmark ml-2"></i> خطأ: لم يتم العثور على بيانات المستخدم.', 'error');
            return;
        }

        const currentPoints = userData.points || 0;

        if (currentPoints < item.price) {
            // استخدام أيقونة Font Awesome
            displayMessage(`<i class="fa-solid fa-circle-xmark ml-2"></i> ليس لديك نقاط كافية. تحتاج ${item.price.toLocaleString('en-US')} نقطة.`, 'error');
            return;
        }

        await updateDoc(userDocRef, {
            points: increment(-item.price),
            counter_quantity: increment(item.value),
            purchase_history: arrayUnion({
                item_id: item.id,
                item_name: item.name,
                price: item.price,
                date: new Date().toISOString()
            })
        });

        if (window.location.pathname.endsWith('boosts.html')) {
            loadBoostsPageData(user);
        }

        // استخدام أيقونة Font Awesome
        displayMessage(`<i class="fa-solid fa-circle-check ml-2"></i> تم شراء "${item.name}" بنجاح!`, 'success');
        setTimeout(() => {
            redirectTo('dashboard.html');
        }, 2000);

    } catch (error) {
        console.error("خطأ في عملية الشراء:", error);
        // استخدام أيقونة Font Awesome
        displayMessage('<i class="fa-solid fa-circle-xmark ml-2"></i> فشلت عملية الشراء. حاول مجدداً.', 'error');
    }
}

// دالة تحميل واجهة المتجر (مُعدَّلة لتطبيق Tailwind Dark Mode)
async function loadBoostsPageData(user) {
    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);

    const pointsElement = document.getElementById('current-user-points');
    const listElement = document.getElementById('boosts-list');

    if (!pointsElement || !listElement) return;

    if (docSnap.exists()) {
        const userData = docSnap.data();
        const currentPoints = userData.points || 0;

        // تحديث النقاط بلون ثانوي (Secondary Color)
        pointsElement.textContent = currentPoints.toLocaleString('en-US');
        pointsElement.classList.add('text-secondary');
        listElement.innerHTML = '';

        // افتراض أن BOOST_ITEMS متاح هنا
        // يجب أن تكون مُعرَّفة إما كـ import أو في نفس الملف/مجال الرؤية
        if (typeof BOOST_ITEMS === 'undefined') {
            listElement.innerHTML = '<p class="text-red-400 p-4 bg-dark-bg/50 rounded-lg">خطأ: قائمة المنتجات (BOOST_ITEMS) غير مُعرَّفة.</p>';
            return;
        }


        BOOST_ITEMS.forEach(item => {
            const itemDiv = document.createElement('div');

            // 1. فئات Tailwind لبطاقة المنتج
            itemDiv.className = 'boost-item bg-dark-bg p-4 mb-3 rounded-lg border border-gray-700 flex justify-between items-center transition duration-200 hover:border-primary/50';

            const canBuy = currentPoints >= item.price;

            // 2. فئات Tailwind للأزرار (موحدة)
            const baseButtonClasses = 'py-2 px-4 rounded-lg font-bold transition duration-200 text-sm flex items-center justify-center';
            const enabledButtonClasses = `bg-amber-500 text-gray-900 hover:bg-amber-400 ${baseButtonClasses}`;
            const disabledButtonClasses = `bg-gray-600 text-gray-300 cursor-not-allowed ${baseButtonClasses}`;

            const buttonClass = canBuy ? enabledButtonClasses : disabledButtonClasses;
            const buttonText = canBuy ? 'شراء الآن <i class="fa-solid fa-cart-shopping mr-1"></i>' : 'نقاط غير كافية <i class="fa-solid fa-ban mr-1"></i>';
            const buttonAttributes = !canBuy ? 'disabled' : '';

            itemDiv.innerHTML = `
                <div class="boost-info flex flex-col items-start">
                    <h4 class="text-lg font-semibold text-white mb-1">${item.name}</h4>
                    <p class="text-gray-400 text-sm flex items-center">
                        <i class="fa-solid fa-plus-circle ml-2 text-primary"></i>
                        إضافة: <strong>+${item.value}</strong> للعداد
                    </p>
                </div>
                <div class="boost-action flex flex-col items-end space-y-2">
                    <p class="price-tag text-xl font-bold text-red-400">${item.price.toLocaleString('en-US')} نقطة</p>
                    <button id="${item.id}" class="${buttonClass}" ${buttonAttributes}>
                        ${buttonText}
                    </button>
                </div>
            `;
            listElement.appendChild(itemDiv);

            if (canBuy) {
                document.getElementById(item.id).addEventListener('click', () => handlePurchase(user, item));
            }
        });

    } else {
        // رسالة خطأ مُعدَّلة للنمط الداكن
        listElement.innerHTML = '<p class="text-red-400 p-4 bg-dark-bg/50 rounded-lg"><i class="fa-solid fa-circle-xmark ml-2"></i> خطأ في جلب بيانات النقاط.</p>';
    }
}

// ======================================================
// 6. منطق الأحكام والسياسات (Modal Logic) 
// ======================================================

function setupTermsModal() {
    const termsBtn = document.getElementById('terms-btn');
    const modal = document.getElementById('terms-modal');
    const closeBtn = document.querySelector('.close-btn');
    const termsTextContainer = document.getElementById('terms-text');

    const rules = [{
            text: "**1. شراء النقاط:** ممنوع شراء النقاط من غير الوكلاء المدرجة أسماؤهم في البوت، والمخالفة تؤدي إلى **حظر الطرفين**.",
            icon: '🛑',
            type: 'bad'
        },
        {
            text: "**2. استلام النقاط:** يمنع استلام كميات كبيرة أو غير اعتيادية من حسابات وهمية أو حقيقية، وستؤدي المخالفة إلى **حظر الطرفين**.",
            icon: '🛑',
            type: 'bad'
        },
        {
            text: "**3. التحايل والانتحال:** أي محاولة للتحايل على الوكلاء أو قسم الدعم أو الانتحال كأحد أفراد الإدارة تؤدي إلى **الحظر الدائم**.",
            icon: '⛔️',
            type: 'bad'
        },
        {
            text: "**4. التعامل مع القروض:** إرسال أو استلام النقاط من أصحاب القروض يؤدي إلى **إنذارات وحظر أسبوعي**.",
            icon: '⚠️',
            type: 'bad'
        },
        {
            text: "**5. المطورين والمشاريع الأخرى:** ممنوع استثمار أي دعم أو مشاريع لمطورين آخرين داخل البوت بأي شكل كان.",
            icon: '🚫',
            type: 'bad'
        },
        {
            text: "**6. التسقيط والإساءة:** أي محاولة تسقيط أو تشويه سمعة المستخدمين أو الإدارة تُعاقب بـ **الحظر الشهري أو السنوي**.",
            icon: '🚷',
            type: 'bad'
        },
        {
            text: "**7. مسؤولية الحساب والأرباح:** المتجر غير مسؤول عن أي مشاكل تتعلق بحسابك في تيليجرام، وأرباح المتجر قابلة للصعود والنزول حسب طبيعة الاستثمار.",
            icon: '✅',
            type: 'good'
        },
        {
            text: "**8. فترة السحب القصوى:** في حال لم يقم المستخدم بالسحب خلال مدة أقصاها **45 يوم**، يتم حظر الحساب بشكل تلقائي.",
            icon: '⏰',
            type: 'bad'
        }
    ];

    if (termsTextContainer) {
        termsTextContainer.innerHTML = rules.map(rule => `
            <div class="rule-item rule-item-${rule.type}">
                <span class="rule-icon">${rule.icon}</span>
                <span class="rule-text">${rule.text}</span>
            </div>
        `).join('');
    }

    if (termsBtn && modal) {
        termsBtn.addEventListener('click', () => {
            modal.style.display = "block";
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = "none";
        });
    }

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    });
}


// ======================================================
// 7. ربط الدوال وإدارة حالة الصفحات (Main Execution)
// ======================================================

document.addEventListener('DOMContentLoaded', async() => {
    // تحميل التهيئة من info.json أولاً
    const ok = await loadConfig();
    if (!ok) {
        console.error("Failed to load config. Aborting initialization.");
        // نستمر لكن بدون firebase لن تعمل وظائف المصادقة/قاعدة البيانات
    }

    // تهيئة Firebase الآن بعد تحميل firebaseConfig
    if (firebaseConfig) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    } else {
        console.error("firebaseConfig is missing; Firebase not initialized.");
    }

    // ربط نماذج التسجيل والدخول العادية
    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.addEventListener('submit', handleRegistration);
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // **ربط نموذج دخول المطور**
    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin);

    // ربط زر الخروج (للمستخدم العادي والمطور)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async() => {
            const isUserAdmin = isAuthenticatedAdmin();

            if (isUserAdmin) {
                sessionStorage.removeItem(DEV_TOKEN_KEY);
                displayMessage('تم تسجيل خروج المطور بنجاح.', 'success');
                redirectTo('admin-login.html');
                return;
            }

            try {
                await signOut(auth);
                displayMessage('تم تسجيل الخروج بنجاح.', 'success');
                redirectTo('index.html');
            } catch (error) {
                console.error("خطأ في تسجيل الخروج:", error);
                displayMessage('فشل تسجيل الخروج.', 'error');
            }
        });
    }

    // **إدارة الصفحات الداخلية**
    const path = window.location.pathname;

    // تهيئة لوحة تحكم المطور
    if (path.endsWith('admin.html')) {
        setupAdminPanel();
    } else if (path.endsWith('dashboard.html') || path.endsWith('boosts.html') || path.endsWith('withdraw.html')) {
        // منطق الصفحات العادية (الداشبورد، المتجر، السحب)
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // تحميل بيانات الصفحة المناسبة
                if (path.endsWith('dashboard.html')) {
                    loadDashboardData(user);

                    // منطق تحويل النقاط للـ Dashboard
                    const transferBtn = document.getElementById('transfer-points-btn');
                    const transferModal = document.getElementById('transfer-modal');
                    const closeTransferBtn = document.querySelector('.close-transfer-btn');
                    const searchRecipientBtn = document.getElementById('search-recipient-btn');
                    const transferForm = document.getElementById('transfer-form');

                    let recipientUserData = null; // لحفظ بيانات المستلم بعد البحث

                    if (transferBtn && transferModal) {
                        // فتح الـ Modal
                        transferBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            transferModal.classList.remove('hidden');
                            transferModal.classList.add('flex');
                            // إعادة تعيين الواجهة عند الفتح
                            document.getElementById('recipient-details').classList.add('hidden');
                            document.getElementById('transfer-amount-group').style.display = 'none';
                            document.getElementById('final-transfer-btn').style.display = 'none';
                            document.getElementById('recipient-id').value = '';
                            document.getElementById('transfer-amount').value = '';
                            recipientUserData = null;
                        });

                        // إغلاق الـ Modal
                        closeTransferBtn.addEventListener('click', () => {
                            transferModal.classList.add('hidden');
                            transferModal.classList.remove('flex');
                        });
                        transferModal.addEventListener('click', (e) => {
                            if (e.target === transferModal) {
                                transferModal.classList.add('hidden');
                                transferModal.classList.remove('flex');
                            }
                        });

                        // منطق البحث عن المستلم
                        searchRecipientBtn.addEventListener('click', async() => {
                            const recipientId = parseInt(document.getElementById('recipient-id').value, 10);

                            if (isNaN(recipientId)) {
                                displayMessage('❌ الرجاء إدخال ID رقمي صالح.', 'error');
                                return;
                            }

                            // لا يمكن التحويل لنفسه، يتم التحقق داخل الدالة
                            recipientUserData = await findUserByNumericIdForTransfer(recipientId);

                            const detailsDiv = document.getElementById('recipient-details');
                            const amountGroup = document.getElementById('transfer-amount-group');
                            const finalBtn = document.getElementById('final-transfer-btn');

                            if (recipientUserData) {
                                // عرض التفاصيل وتفعيل حقل المبلغ
                                document.getElementById('recipient-name-display').textContent = recipientUserData.username || 'N/A';
                                document.getElementById('recipient-points-display').textContent = (recipientUserData.points || 0).toLocaleString();
                                document.getElementById('recipient-referral-code-display').textContent = recipientUserData.referral_code || 'N/A';

                                detailsDiv.classList.remove('hidden');
                                amountGroup.style.display = 'block';
                                finalBtn.style.display = 'block';
                            } else {
                                // إخفاء في حال الفشل
                                detailsDiv.classList.add('hidden');
                                amountGroup.style.display = 'none';
                                finalBtn.style.display = 'none';
                            }
                        });

                        // منطق تنفيذ التحويل النهائي
                        transferForm.addEventListener('submit', async(e) => {
                            e.preventDefault();
                            const transferAmount = parseInt(document.getElementById('transfer-amount').value, 10);

                            if (!recipientUserData || !auth.currentUser) {
                                displayMessage('❌ خطأ: لم يتم تحديد المرسل أو المستلم.', 'error');
                                return;
                            }

                            if (isNaN(transferAmount) || transferAmount < 1) {
                                displayMessage('❌ يجب أن يكون مبلغ التحويل رقماً صحيحاً وموجباً.', 'error');
                                return;
                            }

                            const senderUid = auth.currentUser.uid;
                            const recipientUid = recipientUserData.uid;

                            // يجب أن يكون الرصيد كافياً للمبلغ + العمولة (يتم التحقق داخل executePointTransfer)
                            const success = await executePointTransfer(senderUid, recipientUid, transferAmount);

                            if (success) {
                                transferModal.classList.add('hidden');
                                transferModal.classList.remove('flex');
                                // إعادة تحميل بيانات لوحة التحكم بعد نجاح التحويل لعرض الرصيد الجديد
                                loadDashboardData(auth.currentUser, true);
                            }
                        });
                    }

                } else if (path.endsWith('boosts.html')) {
                    loadBoostsPageData(user);
                }
            } else {
                redirectTo('index.html');
            }
        });
    }

    // تهيئة الـ Modal في جميع الصفحات التي تحتوي على الزر
    setupTermsModal();


});
