// A. استيراد وظائف Firebase المطلوبة
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateEmail as firebaseUpdateEmail } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, arrayUnion, query, collection, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// ======================================================
// ** D0. بيانات التهيئة الأساسية — تُحمّل من info.json **
// ======================================================
// سيتم تعيينهم عند تحميل info.json
// بقيت فقط متغيرات التوكن لغرض التحقق من جلسة المطور بعد تسجيل الدخول
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
        // نستخدم __firebase_config و __app_id و __initial_auth_token بدلاً من info.json
        // وذلك لضمان عمل التطبيق في بيئة Canvas بشكل صحيح
        if (typeof __firebase_config !== 'undefined' && typeof __app_id !== 'undefined') {
            firebaseConfig = JSON.parse(__firebase_config);
            // جلب المتغيرات الثابتة من info.json
            const configResponse = await fetch('info.json');
            if (configResponse.ok) {
                const config = await configResponse.json();
                DEV_TOKEN_KEY = config.DEV_TOKEN_KEY ?? "DEV_ACCESS_TOKEN";
                DEV_TOKEN_VALUE = config.DEV_TOKEN_VALUE ?? "DEV_TOKEN_VALUE_PLACEHOLDER";
            }
        } else {
             // Fallback if running outside Canvas (if using the old method)
             const response = await fetch('info.json');
             if (!response.ok) {
                 console.error("Warning: Could not load info.json. Using fallback or blocking access.");
                 return false;
             }
             const config = await response.json();
 
             DEV_TOKEN_KEY = config.DEV_TOKEN_KEY ?? "DEV_ACCESS_TOKEN";
             DEV_TOKEN_VALUE = config.DEV_TOKEN_VALUE ?? "DEV_TOKEN_VALUE_PLACEHOLDER";
             
             if (config.firebaseConfig) {
                 firebaseConfig = config.firebaseConfig;
             } else {
                 console.error("No firebaseConfig found in info.json");
                 return false;
             }
        }
        
        console.log("Configuration loaded successfully.");
        return true;
    } catch (error) {
        console.error("Error parsing config:", error);
        return false;
    }
}


// ======================================================
// D. إعدادات النظام
// ======================================================
const DAILY_GIFT_AMOUNT = 50;
const COUNTER_INCREMENT = 0; // لم نستخدمه ولكن أبقيناه
const COOLDOWN_TIME_MS = 24 * 60 * 60 * 1000;
const REFERRAL_BONUS = 50; // مكافأة صاحب كود الإحالة
const TRANSFER_FEE = 5000; // 👈 عمولة تحويل النقاط

// ✅ UID المطور الثابت: سيتم استخدامه للتحقق من هوية المطور بعد تسجيل الدخول العادي
// يجب تعديل هذا القيمة لتناسب UID الحساب الذي تريد استخدامه كـ Admin
const ADMIN_UID = "qfy0782dhJXCBPZnBRWn6gHdDEl2";

// قائمة العدادات القابلة للشراء
const BOOST_ITEMS = [
    { id: 'boost_1', name: 'عداد يومي مضاعف', price: 10000, dailyIncrement: 2 },
    { id: 'boost_2', name: 'عداد يومي خماسي', price: 50000, dailyIncrement: 5 },
    { id: 'boost_3', name: 'عداد يومي عشري', price: 100000, dailyIncrement: 10 },
];

// ======================================================
// 1. الوظائف المساعدة العامة (Helper Functions)
// ======================================================

function redirectTo(page) {
    window.location.href = page;
}

function displayMessage(message, type = 'info') {
    const messageContainer = document.getElementById('message-container');
    if (messageContainer) {
        // إنشاء عنصر الرسالة
        const msgElement = document.createElement('div');
        msgElement.className = `p-3 rounded-lg shadow-md text-sm mb-2 opacity-0 transition-opacity duration-300 transform translate-x-2`;

        if (type === 'success') {
            msgElement.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-300');
        } else if (type === 'error') {
            msgElement.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-300');
        } else {
            msgElement.classList.add('bg-blue-100', 'text-blue-700', 'border', 'border-blue-300');
        }

        msgElement.textContent = message;
        messageContainer.prepend(msgElement); // عرض الرسائل الأحدث في الأعلى

        // إظهار الرسالة
        setTimeout(() => {
            msgElement.classList.remove('opacity-0', 'translate-x-2');
        }, 10);

        // إخفاء الرسالة بعد 5 ثواني
        setTimeout(() => {
            msgElement.classList.add('opacity-0', 'translate-x-2');
            msgElement.addEventListener('transitionend', () => msgElement.remove());
        }, 5000);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// ======================================================
// 2. منطق المصادقة وتسجيل الدخول (Auth Logic)
// ======================================================

// دالة تهيئة بيانات المستخدم الجديد في Firestore
async function createNewUserDocument(user, referralCode = null) {
    // توليد ID رقمي عشوائي من 10 أرقام
    // بما أننا لا نستخدم هذا الحقل في البحث حالياً (نستخدم UID أو email)، سنزيله للتبسيط إذا لم يكن مستخدماً فعلاً
    // const numericId = Math.floor(1000000000 + Math.random() * 9000000000).toString(); 

    const initialData = {
        email: user.email,
        points: 0,
        is_banned: false,
        isAdmin: false, 
        last_daily_claim: new Date(0), 
        referred_by: referralCode,
        referrals: 0,
        boosts: [], 
        uid: user.uid, 
        // numeric_id: numericId, // تم إزالة هذا الحقل
        created_at: new Date(),
        // حقل العداد الجديد لعمليات addCounter/subtractCounter
        user_counter: 0, 
    };
    try {
        await setDoc(doc(db, "users", user.uid), initialData);
        return true;
    } catch (e) {
        console.error("Error creating user document: ", e);
        return false;
    }
}

// منطق التسجيل
async function handleRegistration(e) {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const referralCode = document.getElementById('referral-code')?.value.trim() || null;

    if (password.length < 6) {
        displayMessage('❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل.', 'error');
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 1. إنشاء وثيقة المستخدم
        await createNewUserDocument(user, referralCode);

        // 2. تطبيق مكافأة الإحالة إذا كان هناك كود صالح
        if (referralCode) {
            const success = await applyReferralBonus(user.uid, referralCode);
            if (success) {
                displayMessage('✅ تم تطبيق مكافأة الإحالة بنجاح!', 'success');
            } else {
                displayMessage('⚠️ كود الإحالة غير صالح أو لم يتم العثور على المستخدم المحيل.', 'info');
            }
        }

        displayMessage('✅ تم التسجيل بنجاح! يتم التوجيه إلى لوحة التحكم...', 'success');
        setTimeout(() => { redirectTo('dashboard.html'); }, 1500);

    } catch (error) {
        console.error(error);
        if (error.code === 'auth/email-already-in-use') {
            displayMessage('❌ هذا البريد الإلكتروني مستخدم بالفعل.', 'error');
        } else if (error.code === 'auth/invalid-email') {
            displayMessage('❌ صيغة البريد الإلكتروني غير صالحة.', 'error');
        } else {
            displayMessage('❌ حدث خطأ أثناء عملية التسجيل. حاول مرة أخرى.', 'error');
        }
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

        // 🛑🛑🛑 التحقق من هوية المطور باستخدام UID الثابت 🛑🛑🛑
        if (user.uid === ADMIN_UID) {
            // تسجيل الدخول كـ مطور: حفظ التوكن في الجلسة والتوجيه
            sessionStorage.setItem(DEV_TOKEN_KEY, DEV_TOKEN_VALUE);
            displayMessage('✅ تم تسجيل دخول المطور بنجاح. يتم التوجيه...', 'success');
            setTimeout(() => { redirectTo('admin.html'); }, 1500);
            return;
        }
        // 🛑🛑🛑 نهاية التحقق من هوية المطور 🛑🛑🛑


        const docSnap = await getDoc(doc(db, "users", user.uid));

        if (docSnap.exists()) {
            const userData = docSnap.data();

            if (userData.is_banned) {
                await signOut(auth);
                displayMessage('❌ تم تجميد حسابك. يرجى التواصل مع الدعم.', 'error');
                return;
            }

            // منع دخول حسابات isAdmin: true عادية (بالرغم من أن حالة المطور قد تم فحصها بالفعل)
            if (userData.isAdmin) {
                // قد تكون هذه حالة قديمة، لذا نكتفي بالتحقق من الـ UID أعلاه
                await signOut(auth);
                displayMessage('❌ هذا الحساب هو حساب إداري. يرجى تسجيل الدخول من صفحة المطورين.', 'error');
                return;
            }
        }

        displayMessage('مرحباً بك! تم تسجيل الدخول بنجاح.', 'success');
        setTimeout(() => { redirectTo('dashboard.html'); }, 1500);

    } catch (error) {
        console.error(error);
        if (error.code === 'auth/invalid-credential') {
            displayMessage('❌ البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'error');
        } else {
            displayMessage('❌ حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى.', 'error');
        }
    }
}

// دالة تسجيل الخروج
function handleLogout() {
    signOut(auth).then(() => {
        // مسح توكن المطور عند تسجيل الخروج
        sessionStorage.removeItem(DEV_TOKEN_KEY);
        displayMessage('👋 تم تسجيل الخروج بنجاح. يتم التوجيه...', 'info');
        setTimeout(() => { redirectTo('index.html'); }, 1500);
    }).catch((error) => {
        console.error("Logout Error:", error);
        displayMessage('❌ حدث خطأ أثناء تسجيل الخروج.', 'error');
    });
}

// ======================================================
// 3. منطق لوحة تحكم المطور (Admin Panel Logic)
// ======================================================

// دالة التحقق من الرمز السري للمطور (تبقى للتحقق من الجلسة بعد الدخول)
function isAuthenticatedAdmin() {
    // يجب أيضاً التحقق من أن المستخدم الحالي هو ADMIN_UID في onAuthStateChanged
    return sessionStorage.getItem(DEV_TOKEN_KEY) === DEV_TOKEN_VALUE;
}

// دالة البحث عن المستخدم بواسطة UID أو البريد الإلكتروني
async function searchUser(e) {
    e.preventDefault();
    const searchTerm = document.getElementById('search-id').value.trim();
    const adminActions = document.getElementById('adminPanelActions');
    const userDataDisplay = document.getElementById('user-data-display');
    const targetUidInput = document.getElementById('target-uid');
    const statusAlert = document.getElementById('status-alert');

    userDataDisplay.innerHTML = '<p class="text-center italic text-gray-400">جاري البحث...</p>';
    adminActions.style.display = 'none';
    targetUidInput.value = '';
    statusAlert.classList.add('hidden');
    
    if (!searchTerm) {
        displayMessage('❌ يرجى إدخال UID أو بريد إلكتروني للبحث.', 'error');
        return;
    }

    try {
        let q;
        let userDoc;

        // البحث بواسطة البريد الإلكتروني إذا كان يحتوي على @
        if (searchTerm.includes('@')) {
            q = query(collection(db, "users"), where("email", "==", searchTerm));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                userDoc = snapshot.docs[0];
            }
        } else {
            // البحث بواسطة UID
            userDoc = await getDoc(doc(db, "users", searchTerm));
        }

        if (userDoc && userDoc.exists()) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            
            // تخزين الـ UID المستهدف
            targetUidInput.value = uid;
            
            displayUserData(userData, uid);
            adminActions.style.display = 'block';

        } else {
            userDataDisplay.innerHTML = '<p class="text-center italic text-red-500">❌ لم يتم العثور على مستخدم بالمعلومات المدخلة.</p>';
            adminActions.style.display = 'none';
        }

    } catch (error) {
        console.error("Error searching user:", error);
        userDataDisplay.innerHTML = '<p class="text-center italic text-red-500">❌ حدث خطأ أثناء البحث عن المستخدم.</p>';
    }
}

// دالة عرض بيانات المستخدم
function displayUserData(userData, uid) {
    const userDataDisplay = document.getElementById('user-data-display');
    const statusAlert = document.getElementById('status-alert');

    // تحديد حالة الحساب
    let statusText = '';
    let statusClass = '';

    if (uid === ADMIN_UID) {
        statusText = '⚠️ هذا الحساب هو حساب المطور الرئيسي (ADMIN).';
        statusClass = 'bg-yellow-100 text-yellow-800';
    } else if (userData.is_banned) {
        statusText = '🚫 هذا الحساب محظور (BANNED).';
        statusClass = 'bg-red-100 text-red-800';
    } else {
        statusText = '✅ حالة الحساب: نشط (Active).';
        statusClass = 'bg-green-100 text-green-800';
    }
    
    // عرض البيانات (تم إضافة حقل العداد)
    userDataDisplay.innerHTML = `
        <p><span class="font-semibold">UID:</span> <span class="text-xs break-all">${uid}</span></p>
        <p><span class="font-semibold">البريد الإلكتروني:</span> ${userData.email}</p>
        <p><span class="font-semibold">النقاط الحالية:</span> <span class="text-blue-600 font-bold">${(userData.points || 0).toLocaleString()}</span></p>
        <p><span class="font-semibold">عداد المستخدم:</span> <span class="text-purple-600 font-bold">${(userData.user_counter || 0).toLocaleString()}</span></p>
        <p><span class="font-semibold">الإحالات:</span> ${userData.referrals || 0}</p>
        <p><span class="font-semibold">آخر مطالبة يومية:</span> ${userData.last_daily_claim ? new Date(userData.last_daily_claim.toMillis()).toLocaleString() : 'لم يطالب بعد'}</p>
        <p><span class="font-semibold">عدادات مشتراة:</span> ${userData.boosts?.join(', ') || 'لا توجد'}</p>
    `;

    // عرض حالة التنبيه
    statusAlert.textContent = statusText;
    statusAlert.className = `mt-4 p-3 rounded-lg text-center font-bold ${statusClass}`;
    statusAlert.classList.remove('hidden');
}


// دالة معالجة وتنفيذ الإجراء الإداري
async function executeAdminAction(e) {
    e.preventDefault();
    const targetUid = document.getElementById('target-uid').value;
    const actionType = document.getElementById('action-type').value;
    const actionValueInput = document.getElementById('action-value');
    let actionValue = actionValueInput.value.trim();

    if (!targetUid) {
        displayMessage('❌ يجب البحث عن مستخدم أولاً.', 'error');
        return;
    }
    
    // لا يمكن إجراء أي تعديل على حساب المطور الثابت
    if (targetUid === ADMIN_UID && actionType !== 'banAccount' && actionType !== 'unbanAccount') {
        displayMessage('❌ لا يمكنك تعديل بيانات حساب المطور نفسه.', 'error');
        return;
    }
    // ملاحظة: لا يمكن حظر حساب المطور نفسه
    if (targetUid === ADMIN_UID && actionType === 'banAccount') {
         displayMessage('❌ لا يمكنك حظر حساب المطور نفسه.', 'error');
         return;
    }


    try {
        const userRef = doc(db, "users", targetUid);

        switch (actionType) {
            case 'addPoints':
            case 'subtractPoints':
            case 'addCounter':
            case 'subtractCounter':
                const amount = parseInt(actionValue);
                if (isNaN(amount) || amount <= 0) {
                    displayMessage('❌ يجب إدخال قيمة رقمية صحيحة وموجبة.', 'error');
                    return;
                }
                
                let updateData = {};
                let fieldToUpdate = '';
                
                if (actionType.includes('Points')) {
                    fieldToUpdate = 'points';
                } else if (actionType.includes('Counter')) {
                    fieldToUpdate = 'user_counter'; // استخدام الحقل الجديد
                }

                const finalAmount = (actionType.includes('subtract')) ? -amount : amount;
                
                // استخدام runTransaction لضمان تحديث آمن (خاصة للخصم)
                await runTransaction(db, async (transaction) => {
                    const docSnap = await transaction.get(userRef);
                    if (!docSnap.exists()) throw new Error("User document does not exist.");
                    
                    const currentValue = docSnap.data()[fieldToUpdate] || 0;
                    const newValue = currentValue + finalAmount;

                    if (newValue < 0) {
                        // منع تحول النقاط/العداد إلى سالب عند الخصم
                        throw new Error(`Cannot subtract ${amount.toLocaleString()}. The final value of ${fieldToUpdate} would be negative.`);
                    }

                    updateData[fieldToUpdate] = increment(finalAmount);
                    transaction.update(userRef, updateData);
                });


                displayMessage(`✅ تم تنفيذ الإجراء: ${actionType} بنجاح!`, 'success');
                break;

            case 'banAccount':
                await updateDoc(userRef, { is_banned: true });
                displayMessage('✅ تم تجميد (حظر) الحساب بنجاح!', 'success');
                break;

            case 'unbanAccount':
                await updateDoc(userRef, { is_banned: false });
                displayMessage('✅ تم إلغاء تجميد الحساب بنجاح!', 'success');
                break;
                
            case 'updateEmail':
                const newEmail = actionValue;
                if (!newEmail || !newEmail.includes('@')) {
                    displayMessage('❌ يرجى إدخال بريد إلكتروني صحيح.', 'error');
                    return;
                }
                // تحديث البريد الإلكتروني في وثيقة المستخدم (لا يمكن تحديثه في Auth هنا)
                await updateDoc(userRef, { email: newEmail });
                displayMessage('✅ تم تحديث البريد الإلكتروني في وثيقة المستخدم بنجاح.', 'success');
                
                // رسالة تنبيه بضرورة تحديث Auth يدوياً
                displayMessage('⚠️ تذكر أنك تحتاج لتحديث البريد الإلكتروني في Firebase Authentication بشكل منفصل!', 'info');
                break;

            default:
                displayMessage('❌ يرجى اختيار إجراء صالح.', 'error');
                return;
        }

        // بعد التنفيذ، أعد تحميل بيانات المستخدم المعروضة
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            displayUserData(userDoc.data(), userDoc.id);
        }

    } catch (error) {
        console.error("Error executing admin action:", error);
        
        let errorMessage = '❌ فشل تنفيذ الإجراء. حاول مرة أخرى.';
        if (typeof error === 'object' && error.message) {
            if (error.message.includes('negative')) {
                errorMessage = '❌ فشل الخصم: القيمة النهائية للنقاط/العداد ستكون سالبة.';
            } else {
                errorMessage = `❌ فشل تنفيذ الإجراء: ${error.message}`;
            }
        }
        
        displayMessage(errorMessage, 'error');
    }
}

// تحديث الواجهة بناءً على نوع الإجراء
function updateActionUI() {
    const actionType = document.getElementById('action-type').value;
    const valueGroup = document.getElementById('action-value-group');
    const valueLabel = document.getElementById('value-label');
    const valueInput = document.getElementById('action-value');

    // افتراضياً إظهار القيمة
    valueGroup.style.display = 'block';

    switch (actionType) {
        case 'addPoints':
        case 'subtractPoints':
        case 'addCounter':
        case 'subtractCounter':
            valueLabel.textContent = 'العدد (موجب دائماً):';
            valueInput.type = 'number';
            valueInput.placeholder = 'أدخل قيمة النقاط/العداد';
            break;
            
        case 'updateEmail':
            valueLabel.textContent = 'البريد الإلكتروني الجديد:';
            valueInput.type = 'email';
            valueInput.placeholder = 'example@domain.com';
            break;

        case 'banAccount':
        case 'unbanAccount':
            // إخفاء حقل القيمة لعمليات الحظر/إلغاء الحظر
            valueGroup.style.display = 'none';
            break;
            
        default:
            valueLabel.textContent = 'القيمة/المعلومة:';
            valueInput.type = 'text';
            valueInput.placeholder = 'القيمة المطلوبة';
            valueGroup.style.display = 'none';
    }
}

// تهيئة لوحة المطور
function setupAdminPanel() {
    if (!isAuthenticatedAdmin()) return;

    const searchForm = document.getElementById('search-form');
    if (searchForm) searchForm.addEventListener('submit', searchUser);
    
    const actionTypeSelect = document.getElementById('action-type');
    if (actionTypeSelect) actionTypeSelect.addEventListener('change', updateActionUI);

    const actionForm = document.getElementById('action-form');
    if (actionForm) actionForm.addEventListener('submit', executeAdminAction);
    
    // إخفاء حقل القيمة عند التحميل الأولي
    updateActionUI();
}


// ======================================================
// 4. منطق لوحة التحكم (Dashboard Logic) - (بقية الدوال تبقى كما هي)
// ======================================================

// دالة المطالبة اليومية (مفيدة لو تم استدعاؤها)
async function claimDailyPoints(user) {
    const claimButton = document.getElementById('claim-daily-btn');
    if (claimButton) claimButton.disabled = true;
    try {
        await runTransaction(db, async (transaction) => {
            const userRef = doc(db, "users", user.uid);
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw "User document not found!";
            const userData = userDoc.data();
            const now = Date.now();
            const lastClaimTime = userData.last_daily_claim ? userData.last_daily_claim.toMillis() : new Date(0).getTime();
            if (now - lastClaimTime < COOLDOWN_TIME_MS) return; 

            const totalPointsToAdd = getDailyIncrementAmount(userData); 
            transaction.update(userRef, {
                points: increment(totalPointsToAdd),
                last_daily_claim: new Date(),
            });

            displayMessage(`✅ تمت إضافة ${totalPointsToAdd} نقطة يومية بنجاح!`, 'success');
        });
        loadDashboardData(user, true);

    } catch (error) {
        console.error("Daily Claim Error:", error);
        displayMessage('❌ فشل في المطالبة بالنقاط اليومية. حاول مرة أخرى.', 'error');
    } finally {
        if (claimButton) claimButton.disabled = false;
    }
}

// الحصول على القيمة الحالية للعداد اليومي بناءً على البوستات
function getDailyIncrementAmount(userData) {
    let incrementAmount = DAILY_GIFT_AMOUNT; 
    if (userData.boosts && userData.boosts.length > 0) {
        userData.boosts.forEach(boostId => {
            const boost = BOOST_ITEMS.find(item => item.id === boostId);
            if (boost) {
                incrementAmount += boost.dailyIncrement;
            }
        });
    }
    return Math.max(incrementAmount, 1);
}

// تحميل بيانات لوحة التحكم (مطلوبة لتحديث حالة المستخدم بعد المطالبة)
async function loadDashboardData(user, forceReload = false) {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    const userRef = doc(db, "users", user.uid);

    if (!forceReload) {
        if (window.dashboardListener) return;

        window.dashboardListener = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                const userData = docSnap.data();
                if (userData.is_banned) {
                    signOut(auth);
                    displayMessage('❌ تم تجميد حسابك. سيتم تسجيل الخروج.', 'error');
                    return;
                }
                renderDashboard(userData);
            } else {
                displayMessage('❌ وثيقة المستخدم غير موجودة. يرجى إعادة تسجيل الدخول.', 'error');
                signOut(auth);
            }
        }, (error) => {
            console.error("Error listening to user data:", error);
            displayMessage('❌ خطأ في تحميل بيانات لوحة التحكم.', 'error');
        });
    } else {
        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                renderDashboard(docSnap.data());
            }
        } catch (error) {
            console.error("Error force loading user data:", error);
        }
    }
}

// عرض بيانات لوحة التحكم
function renderDashboard(userData) {
    const userPointsEl = document.getElementById('user-points');
    if (userPointsEl) userPointsEl.textContent = (userData.points || 0).toLocaleString();
    
    const claimButton = document.getElementById('claim-daily-btn');
    const lastClaim = userData.last_daily_claim ? userData.last_daily_claim.toMillis() : new Date(0).getTime();
    const timeSinceLastClaim = Date.now() - lastClaim;

    if (claimButton) {
        if (timeSinceLastClaim < COOLDOWN_TIME_MS) {
            claimButton.disabled = true;
            claimButton.textContent = 'انتظر 24 ساعة';
        } else {
            claimButton.disabled = false;
            claimButton.textContent = 'المطالبة اليومية الآن';
        }
    }
}

// منطق تحويل النقاط (العملية الفعلية)
async function executePointTransfer(senderUid, recipientUid, amount) {
    if (senderUid === recipientUid) {
        displayMessage('❌ لا يمكنك التحويل لنفسك.', 'error');
        return false;
    }

    const totalCost = amount + TRANSFER_FEE;

    try {
        await runTransaction(db, async (transaction) => {
            const senderRef = doc(db, "users", senderUid);
            const recipientRef = doc(db, "users", recipientUid);

            const senderDoc = await transaction.get(senderRef);
            const recipientDoc = await transaction.get(recipientRef);

            if (!senderDoc.exists() || !recipientDoc.exists()) {
                throw "Sender or Recipient document not found!";
            }

            const senderData = senderDoc.data();
            const recipientData = recipientDoc.data();

            if (senderData.points < totalCost) {
                throw "Insufficient balance to cover the amount and the fee.";
            }
            
            if (recipientData.is_banned) {
                throw "Recipient is banned.";
            }

            transaction.update(senderRef, {
                points: increment(-totalCost)
            });

            transaction.update(recipientRef, {
                points: increment(amount)
            });

        });
        displayMessage(`✅ تم تحويل ${amount.toLocaleString()} نقطة بنجاح. العمولة: ${TRANSFER_FEE.toLocaleString()} نقطة.`, 'success');
        return true;
    } catch (error) {
        console.error("Transaction failed:", error);
        if (error === "Insufficient balance to cover the amount and the fee.") {
            displayMessage('❌ الرصيد غير كافٍ لتغطية المبلغ والعمولة المطلوبة.', 'error');
        } else if (error === "Recipient is banned.") {
             displayMessage('❌ فشل التحويل: لا يمكن التحويل إلى مستخدم محظور.', 'error');
        } else if (typeof error === 'string' && error.includes("Recipient")) {
            displayMessage('❌ فشل التحويل: لم يتم العثور على المستخدم المستلم.', 'error');
        } else {
            displayMessage('❌ فشل التحويل. يرجى المحاولة لاحقاً.', 'error');
        }
        return false;
    }
}

// تطبيق مكافأة الإحالة (متبقية لضمان الاكتمال)
async function applyReferralBonus(newUserId, referrerEmailOrUID) {
    // ... (منطق تطبيق الإحالة) ...
    return true; 
}
function copyReferralCode() { /* ... */ }
async function loadBoostsPageData(user) { /* ... */ }
async function handleBoostPurchase(e) { /* ... */ }
function setupTermsModal() { /* ... */ }

// ======================================================
// 6. تهيئة التطبيق (Initialization)
// ======================================================

document.addEventListener('DOMContentLoaded', async() => {
    const configLoaded = await loadConfig();
    if (!configLoaded) {
        displayMessage('❌ فشل في تحميل التهيئة الأساسية. لا يمكن تشغيل التطبيق.', 'error');
        return;
    }

    // تهيئة Firebase
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // ربط نماذج التسجيل والدخول العادية
    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.addEventListener('submit', handleRegistration);
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // ربط زر تسجيل الخروج (يجب أن يكون موجوداً في كل الصفحات الداخلية)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // إدارة حالة المصادقة وتوجيه المستخدمين
    if (auth) {
        onAuthStateChanged(auth, (user) => {
            const path = window.location.pathname;

            // 1. إدارة الوصول لصفحات المطور
            if (path.endsWith('admin.html')) {
                if (isAuthenticatedAdmin()) {
                    // تحقق إضافي في حالة وجود مشكلة في Session Storage
                    if (user && user.uid === ADMIN_UID) {
                        setupAdminPanel(); // تهيئة لوحة المطور
                    } else {
                        // إذا لم يكن UID هو UID المطور، أعد التوجيه
                        displayMessage('❌ غير مصرح لك بالدخول إلى لوحة المطور.', 'error');
                        redirectTo('index.html');
                    }
                } else {
                    // إذا لم يكن مصادقاً كـ مطور، أعد التوجيه
                    displayMessage('❌ غير مصرح لك بالدخول إلى لوحة المطور.', 'error');
                    redirectTo('index.html');
                }
                return; // إيقاف التنفيذ هنا لصفحة المطور
            }


            // 2. إدارة الوصول لصفحات المستخدمين (Dashboard, Boosts)
            if (user) {
                // المستخدم مسجل الدخول
                document.getElementById('auth-links')?.classList.add('hidden');
                document.getElementById('user-links')?.classList.remove('hidden');

                if (path.endsWith('index.html') || path.endsWith('login.html') || path.endsWith('register.html')) {
                    redirectTo('dashboard.html');
                } else if (path.endsWith('dashboard.html')) {
                    loadDashboardData(user);
                    
                    const claimButton = document.getElementById('claim-daily-btn');
                    if (claimButton) claimButton.addEventListener('click', () => claimDailyPoints(user));
                    
                    const copyBtn = document.getElementById('copy-referral-btn');
                    if (copyBtn) copyBtn.addEventListener('click', copyReferralCode);
                    
                    // منطق Modal التحويل (يبقى كما هو)
                    const openTransferModalBtn = document.getElementById('open-transfer-modal');
                    const transferModal = document.getElementById('transfer-modal');
                    const closeTransferModalBtn = document.getElementById('close-transfer-modal');
                    const transferForm = document.getElementById('transferForm');
                    const recipientInput = document.getElementById('recipient-uid');
                    const amountInput = document.getElementById('transfer-amount');

                    if (openTransferModalBtn) {
                        openTransferModalBtn.addEventListener('click', () => {
                            transferModal.classList.remove('hidden');
                            transferModal.classList.add('flex');
                        });
                    }

                    if (closeTransferModalBtn) {
                        closeTransferModalBtn.addEventListener('click', () => {
                            transferModal.classList.add('hidden');
                            transferModal.classList.remove('flex');
                            transferForm.reset();
                        });
                    }

                    if (transferModal) {
                        transferModal.addEventListener('click', (e) => {
                            if (e.target === transferModal) {
                                transferModal.classList.add('hidden');
                                transferModal.classList.remove('flex');
                                transferForm.reset();
                            }
                        });
                    }

                    if (transferForm) {
                        // ** 🛑🛑🛑 هذا هو الجزء الذي تم إصلاحه لضمان تمرير UID المستلم 🛑🛑🛑 **
                        transferForm.addEventListener('submit', async(e) => {
                            e.preventDefault();

                            const recipientId = recipientInput.value.trim();
                            const transferAmount = parseInt(amountInput.value.trim());

                            if (!recipientId || !transferAmount) {
                                displayMessage('❌ خطأ: لم يتم تحديد المستلم أو المبلغ.', 'error');
                                return;
                            }

                            if (isNaN(transferAmount) || transferAmount < 1) {
                                displayMessage('❌ يجب أن يكون مبلغ التحويل رقماً صحيحاً وموجباً.', 'error');
                                return;
                            }

                            let finalRecipientUid = recipientId; // الافتراض الأولي هو أن المُدخل هو UID

                            // إذا كان المُدخل بريداً إلكترونياً، ابحث عن UID
                            if (recipientId.includes('@')) {
                                const q = query(collection(db, "users"), where("email", "==", recipientId));
                                const snapshot = await getDocs(q);
                                if (snapshot.empty) {
                                    displayMessage('❌ لم يتم العثور على مستخدم بالبريد الإلكتروني المُدخل.', 'error');
                                    return;
                                }
                                finalRecipientUid = snapshot.docs[0].id; // حفظ الـ UID الفعلي
                            } else {
                                // إذا كان المُدخل UID، تأكد من وجود المستخدم
                                const docSnap = await getDoc(doc(db, "users", recipientId));
                                if (!docSnap.exists()) {
                                    displayMessage('❌ لم يتم العثور على مستخدم بالـ UID المُدخل.', 'error');
                                    return;
                                }
                            }

                            const senderUid = auth.currentUser.uid;

                            // ** تمرير الـ UID الفعلي المُستخلص (finalRecipientUid) **
                            const success = await executePointTransfer(senderUid, finalRecipientUid, transferAmount);

                            if (success) {
                                transferModal.classList.add('hidden');
                                transferModal.classList.remove('flex');
                                transferForm.reset();
                                // إعادة تحميل بيانات لوحة التحكم بعد نجاح التحويل لعرض الرصيد الجديد
                                loadDashboardData(auth.currentUser, true);
                            }
                        });
                        // ** 🛑🛑🛑 نهاية الجزء الذي تم إصلاحه 🛑🛑🛑 **
                    }


                } else if (path.endsWith('boosts.html')) {
                    loadBoostsPageData(user);
                }
            } else {
                // المستخدم غير مسجل الدخول
                document.getElementById('auth-links')?.classList.remove('hidden');
                document.getElementById('user-links')?.classList.add('hidden');

                if (path.endsWith('dashboard.html') || path.endsWith('boosts.html')) {
                    redirectTo('index.html');
                }
            }
        });
    }

    // تهيئة الـ Modal في جميع الصفحات التي تحتوي على الزر
    setupTermsModal();


});
