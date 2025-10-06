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
        const response = await fetch('info.json');
        if (!response.ok) {
            console.error("Warning: Could not load info.json. Using fallback or blocking access.");
            return false;
        }
        const config = await response.json();

        // ** يتم تجاهل DEV_EMAIL و DEV_PASSWORD في الكود الجديد، لكن يتم قراءة التوكن والـ config **

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

// ✅ UID المطور الثابت: سيتم استخدامه للتحقق من هوية المطور بعد تسجيل الدخول العادي
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
        msgElement.className = `p-3 rounded-lg shadow-md text-sm mb-2 opacity-0 transition-opacity duration-300 transform translate-y-2`;

        if (type === 'success') {
            msgElement.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-300');
        } else if (type === 'error') {
            msgElement.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-300');
        } else {
            msgElement.classList.add('bg-blue-100', 'text-blue-700', 'border', 'border-blue-300');
        }

        msgElement.textContent = message;
        messageContainer.appendChild(msgElement);

        // إظهار الرسالة
        setTimeout(() => {
            msgElement.classList.remove('opacity-0', 'translate-y-2');
        }, 10);

        // إخفاء الرسالة بعد 5 ثواني
        setTimeout(() => {
            msgElement.classList.add('opacity-0', 'translate-y-2');
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
    const initialData = {
        email: user.email,
        points: 0,
        is_banned: false,
        isAdmin: false, // الجميع ليسوا مطورين بشكل افتراضي
        last_daily_claim: new Date(0), // تاريخ قديم جداً
        referred_by: referralCode,
        referrals: 0,
        boosts: [], // العدادات المشتراة
        uid: user.uid, // حفظ الـ UID في الوثيقة
        created_at: new Date(),
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
    return sessionStorage.getItem(DEV_TOKEN_KEY) === DEV_TOKEN_VALUE;
}

// تحميل بيانات المستخدمين في لوحة المطور
async function loadAdminData() {
    if (!isAuthenticatedAdmin()) {
        displayMessage('❌ غير مصرح لك بالدخول إلى لوحة المطور.', 'error');
        redirectTo('index.html');
        return;
    }
    const adminPanel = document.getElementById('admin-panel');
    if (!adminPanel) return;

    try {
        const usersCol = collection(db, "users");
        const userSnapshot = await getDocs(usersCol);
        const userList = document.getElementById('user-list');
        userList.innerHTML = ''; // مسح القائمة القديمة

        let totalPoints = 0;
        let activeUsers = 0;

        userSnapshot.forEach(doc => {
            const userData = doc.data();
            const uid = doc.id;
            const points = userData.points || 0;
            const isBanned = userData.is_banned || false;
            const isAdmin = (uid === ADMIN_UID) ? true : false; // اظهار حالة المطور بناء على الـ UID

            if (!isBanned) {
                totalPoints += points;
                activeUsers++;
            }

            const listItem = document.createElement('li');
            listItem.className = 'flex items-center justify-between p-3 mb-2 bg-white rounded-lg shadow';
            listItem.innerHTML = `
                <div class="flex-1">
                    <p class="font-bold text-gray-800">${userData.email} ${isAdmin ? '(مطور)' : ''}</p>
                    <p class="text-sm text-gray-500">UID: ${uid}</p>
                    <p class="text-sm text-blue-600">النقاط: ${points.toLocaleString()}</p>
                </div>
                <div class="flex space-x-2 rtl:space-x-reverse">
                    <button data-uid="${uid}" data-banned="${isBanned}" class="toggle-ban-btn px-3 py-1 text-sm rounded-lg ${isBanned ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'} text-white transition duration-200">
                        ${isBanned ? 'إلغاء الحظر' : 'حظر'}
                    </button>
                    <button data-uid="${uid}" class="add-points-btn px-3 py-1 text-sm rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition duration-200">
                        إضافة نقاط
                    </button>
                </div>
            `;
            userList.appendChild(listItem);
        });

        // تحديث الإحصائيات
        document.getElementById('total-users').textContent = userSnapshot.docs.length.toLocaleString();
        document.getElementById('active-users').textContent = activeUsers.toLocaleString();
        document.getElementById('total-points').textContent = totalPoints.toLocaleString();

        // ربط الأحداث بعد تحميل القائمة
        document.querySelectorAll('.toggle-ban-btn').forEach(button => {
            button.addEventListener('click', toggleUserBan);
        });
        document.querySelectorAll('.add-points-btn').forEach(button => {
            button.addEventListener('click', promptAddPoints);
        });


    } catch (error) {
        console.error("Error loading admin data:", error);
        displayMessage('❌ حدث خطأ أثناء تحميل بيانات المستخدمين.', 'error');
    }
}

// تبديل حالة حظر المستخدم
async function toggleUserBan(e) {
    const uid = e.target.dataset.uid;
    const isCurrentlyBanned = e.target.dataset.banned === 'true';

    // لا يمكن حظر المطور نفسه
    if (uid === ADMIN_UID) {
        displayMessage('❌ لا يمكنك حظر حساب المطور نفسه.', 'error');
        return;
    }

    try {
        await updateDoc(doc(db, "users", uid), {
            is_banned: !isCurrentlyBanned
        });
        displayMessage(`✅ تم ${isCurrentlyBanned ? 'إلغاء حظر' : 'حظر'} المستخدم ${uid} بنجاح.`, 'success');
        loadAdminData(); // إعادة تحميل البيانات
    } catch (error) {
        console.error("Error toggling ban:", error);
        displayMessage('❌ فشل في تحديث حالة الحظر.', 'error');
    }
}

// مطالبة لإضافة نقاط
function promptAddPoints(e) {
    const uid = e.target.dataset.uid;
    const amountStr = prompt(`أدخل عدد النقاط لإضافتها للمستخدم ${uid}:`);

    if (amountStr === null) return; // المستخدم ألغى العملية

    const amount = parseInt(amountStr);

    if (isNaN(amount) || amount === 0) {
        displayMessage('❌ يجب إدخال رقم صحيح غير صفري.', 'error');
        return;
    }

    // تأكيد قبل التعديل
    if (confirm(`هل أنت متأكد من إضافة/خصم ${amount} نقطة للمستخدم ${uid}؟`)) {
        addPointsToUser(uid, amount);
    }
}

// إضافة/خصم نقاط من المستخدم
async function addPointsToUser(uid, amount) {
    try {
        await updateDoc(doc(db, "users", uid), {
            points: increment(amount)
        });
        displayMessage(`✅ تم ${amount > 0 ? 'إضافة' : 'خصم'} ${Math.abs(amount).toLocaleString()} نقطة للمستخدم ${uid}.`, 'success');
        loadAdminData(); // إعادة تحميل البيانات
    } catch (error) {
        console.error("Error adding points:", error);
        displayMessage('❌ فشل في إضافة/خصم النقاط.', 'error');
    }
}

// ======================================================
// 4. منطق لوحة التحكم (Dashboard Logic)
// ======================================================

// تطبيق مكافأة الإحالة (يُنفذ مرة واحدة عند التسجيل)
async function applyReferralBonus(newUserId, referrerEmailOrUID) {
    try {
        let referrerQuery;

        // 1. البحث عن المستخدم المحيل بالـ UID أو بالبريد الإلكتروني
        if (referrerEmailOrUID.includes('@')) {
            referrerQuery = query(collection(db, "users"), where("email", "==", referrerEmailOrUID));
        } else {
            // يفترض أن يكون UID
            referrerQuery = query(collection(db, "users"), where("uid", "==", referrerEmailOrUID));
        }

        const referrerSnapshot = await getDocs(referrerQuery);
        if (referrerSnapshot.empty) {
            return false;
        }

        // 2. المحيل هو أول نتيجة
        const referrerDoc = referrerSnapshot.docs[0];
        const referrerId = referrerDoc.id;

        // 3. تحديث وثيقة المحيل ضمن عملية Transaction
        await runTransaction(db, async (transaction) => {
            const referrerRef = doc(db, "users", referrerId);
            const newRef = doc(db, "users", newUserId);

            const referrerDocData = await transaction.get(referrerRef);
            if (!referrerDocData.exists()) {
                throw "Referrer does not exist!";
            }

            // إضافة النقاط للمحيل وزيادة عدد الإحالات
            transaction.update(referrerRef, {
                points: increment(REFERRAL_BONUS),
                referrals: increment(1)
            });

            // تحديث وثيقة المستخدم الجديد (للتأكد من تسجيل الـ referred_by بشكل صحيح)
            transaction.update(newRef, {
                points: increment(REFERRAL_BONUS)
            });

        });

        console.log(`Referral bonus applied: ${newUserId} referred by ${referrerId}`);
        return true;

    } catch (error) {
        console.error("Referral Bonus Error:", error);
        // لا نعرض رسالة خطأ للمستخدم الجديد، فقط نرجع false
        return false;
    }
}

// الحصول على القيمة الحالية للعداد اليومي بناءً على البوستات
function getDailyIncrementAmount(userData) {
    let incrementAmount = DAILY_GIFT_AMOUNT; // يجب البدء بقيمة الهدية اليومية الأساسية
    if (userData.boosts && userData.boosts.length > 0) {
        userData.boosts.forEach(boostId => {
            const boost = BOOST_ITEMS.find(item => item.id === boostId);
            if (boost) {
                // يتم إضافة قيمة الزيادة اليومية للبوست إلى المبلغ الأساسي
                incrementAmount += boost.dailyIncrement;
            }
        });
    }
    // يجب أن تكون القيمة الإجمالية لا تقل عن 1 لمنع المشاكل
    return Math.max(incrementAmount, 1);
}

// المطالبة بالنقاط اليومية
async function claimDailyPoints(user) {
    const claimButton = document.getElementById('claim-daily-btn');
    if (!claimButton) return;

    claimButton.disabled = true;

    try {
        await runTransaction(db, async (transaction) => {
            const userRef = doc(db, "users", user.uid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) {
                throw "User document not found!";
            }

            const userData = userDoc.data();
            const now = Date.now();
            
            // تحويل Firestore Timestamp إلى وقت بالمللي ثانية
            const lastClaimTime = userData.last_daily_claim ? userData.last_daily_claim.toMillis() : new Date(0).getTime();
            
            const timeSinceLastClaim = now - lastClaimTime;

            if (timeSinceLastClaim < COOLDOWN_TIME_MS) {
                const remainingTime = COOLDOWN_TIME_MS - timeSinceLastClaim;
                const hours = Math.floor(remainingTime / (60 * 60 * 1000));
                const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
                displayMessage(`⏰ يجب الانتظار. يتبقى: ${hours} ساعة و ${minutes} دقيقة.`, 'info');
                return;
            }

            const totalPointsToAdd = getDailyIncrementAmount(userData); // الحصول على قيمة الزيادة من البوستات

            // تحديث النقاط وآخر وقت للمطالبة
            transaction.update(userRef, {
                points: increment(totalPointsToAdd),
                last_daily_claim: new Date(),
            });

            displayMessage(`✅ تمت إضافة ${totalPointsToAdd} نقطة يومية بنجاح!`, 'success');
        });
        // بعد نجاح العملية، أعد تحميل بيانات لوحة التحكم
        loadDashboardData(user, true);

    } catch (error) {
        console.error("Daily Claim Error:", error);
        displayMessage('❌ فشل في المطالبة بالنقاط اليومية. حاول مرة أخرى.', 'error');
    } finally {
        claimButton.disabled = false;
    }
}

// عرض بيانات لوحة التحكم
function renderDashboard(userData) {
    document.getElementById('user-email').textContent = userData.email;
    document.getElementById('user-uid').textContent = userData.uid;
    document.getElementById('user-points').textContent = (userData.points || 0).toLocaleString();
    document.getElementById('referral-link').value = userData.uid; // استخدام الـ UID ككود إحالة

    // حساب العداد اليومي بناءً على البوستات
    const currentDailyIncrement = getDailyIncrementAmount(userData);
    document.getElementById('daily-increment-amount').textContent = currentDailyIncrement.toLocaleString();
    document.getElementById('transfer-fee').textContent = TRANSFER_FEE.toLocaleString(); // عرض العمولة

    // حالة زر المطالبة اليومية
    const claimButton = document.getElementById('claim-daily-btn');
    
    // تأكد من أن last_daily_claim موجودة وقابلة للتحويل
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

    // عرض عدد الإحالات
    document.getElementById('referrals-count').textContent = (userData.referrals || 0).toLocaleString();
}

// تحميل بيانات لوحة التحكم
async function loadDashboardData(user, forceReload = false) {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    const userRef = doc(db, "users", user.uid);

    // استخدام onSnapshot للاستماع للتغييرات في الوقت الفعلي
    if (!forceReload) {
        // التأكد من أننا نستخدم onSnapshot مرة واحدة فقط
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
        // التحميل القسري (للتأكد بعد عملية مثل التحويل)
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

// نسخ كود الإحالة
function copyReferralCode() {
    const referralLink = document.getElementById('referral-link');
    referralLink.select();
    referralLink.setSelectionRange(0, 99999); // for mobile devices
    try {
        // استخدام navigator.clipboard.writeText أفضل، لكن execCommand أضمن في بعض البيئات
        document.execCommand('copy'); 
        displayMessage('✅ تم نسخ كود الإحالة بنجاح!', 'success');
    } catch (err) {
        // Fallback for better compatibility
        navigator.clipboard.writeText(referralLink.value).then(() => {
            displayMessage('✅ تم نسخ كود الإحالة بنجاح (باستخدام Clipboard API)!', 'success');
        }).catch(() => {
            displayMessage('❌ فشل في نسخ الكود.', 'error');
        });
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

            // 1. خصم المبلغ الكلي (المبلغ + العمولة) من المرسل
            transaction.update(senderRef, {
                points: increment(-totalCost)
            });

            // 2. إضافة المبلغ الصافي للمستلم
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

// تحميل بيانات صفحة البوستات
async function loadBoostsPageData(user) {
    const boostsList = document.getElementById('boosts-list');
    if (!boostsList) return;

    try {
        // استخدام onSnapshot للحصول على تحديثات فورية للنقاط والبوستات
        onSnapshot(doc(db, "users", user.uid), (docSnap) => {
            if (!docSnap.exists()) return;
            const userData = docSnap.data();
            const currentPoints = userData.points || 0;
            const userBoosts = userData.boosts || [];

            boostsList.innerHTML = '';

            BOOST_ITEMS.forEach(boost => {
                const isOwned = userBoosts.includes(boost.id);
                const canAfford = currentPoints >= boost.price;
                const buttonText = isOwned ? 'مُشتراة' : (canAfford ? 'شراء' : 'نقاط غير كافية');

                const listItem = document.createElement('li');
                listItem.className = 'bg-white p-4 rounded-lg shadow-md flex justify-between items-center mb-4';
                listItem.innerHTML = `
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${boost.name}</h3>
                        <p class="text-sm text-gray-600">زيادة يومية: ${boost.dailyIncrement} نقطة</p>
                        <p class="text-blue-600 font-semibold mt-1">السعر: ${boost.price.toLocaleString()} نقطة</p>
                    </div>
                    <button
                        data-boost-id="${boost.id}"
                        data-price="${boost.price}"
                        class="buy-boost-btn px-4 py-2 text-white text-sm rounded-lg transition duration-200
                        ${isOwned ? 'bg-gray-400 cursor-not-allowed' : (canAfford ? 'bg-green-500 hover:bg-green-600' : 'bg-red-400 cursor-not-allowed')}"
                        ${isOwned || !canAfford ? 'disabled' : ''}
                    >
                        ${buttonText}
                    </button>
                `;
                boostsList.appendChild(listItem);
            });

            document.getElementById('current-points-boosts').textContent = currentPoints.toLocaleString();

            // ربط أحداث الشراء
            document.querySelectorAll('.buy-boost-btn').forEach(button => {
                // منع ربط الحدث أكثر من مرة
                if (!button.dataset.listenerAttached) {
                    button.addEventListener('click', handleBoostPurchase);
                    button.dataset.listenerAttached = 'true';
                }
            });

        }, (error) => {
            console.error("Error listening to boosts data:", error);
            displayMessage('❌ خطأ في تحميل قائمة العدادات.', 'error');
        });

    } catch (error) {
        console.error("Error loading boosts data setup:", error);
        displayMessage('❌ خطأ في تحميل قائمة العدادات.', 'error');
    }
}

// معالجة عملية شراء البوست
async function handleBoostPurchase(e) {
    const boostId = e.target.dataset.boostId;
    const price = parseInt(e.target.dataset.price);
    const user = auth.currentUser;

    if (!user) {
        displayMessage('❌ يجب تسجيل الدخول لإجراء عملية الشراء.', 'error');
        return;
    }

    // تأكيد العملية قبل التنفيذ
    if (!confirm(`هل أنت متأكد من شراء هذا العداد مقابل ${price.toLocaleString()} نقطة؟`)) {
        return;
    }

    try {
        await runTransaction(db, async (transaction) => {
            const userRef = doc(db, "users", user.uid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) {
                throw "User document not found!";
            }

            const userData = userDoc.data();
            const currentPoints = userData.points || 0;
            const userBoosts = userData.boosts || [];

            if (userBoosts.includes(boostId)) {
                throw "Boost already owned.";
            }

            if (currentPoints < price) {
                throw "Insufficient points.";
            }

            // تنفيذ الشراء: خصم النقاط وإضافة البوست
            transaction.update(userRef, {
                points: increment(-price),
                boosts: arrayUnion(boostId)
            });
        });

        displayMessage('✅ تم شراء العداد بنجاح!', 'success');
        // لا حاجة لـ loadBoostsPageData(user) هنا لأن onSnapshot سيتولى التحديث

    } catch (error) {
        console.error("Boost purchase error:", error);
        if (error === "Insufficient points.") {
            displayMessage('❌ نقاطك غير كافية لإتمام عملية الشراء.', 'error');
        } else if (error === "Boost already owned.") {
            displayMessage('❌ لديك هذا العداد بالفعل.', 'error');
        } else {
            displayMessage('❌ فشل في إتمام عملية الشراء. حاول مرة أخرى.', 'error');
        }
    }
}


// ======================================================
// 5. وظائف الـ Modal
// ======================================================

function setupTermsModal() {
    const termsModal = document.getElementById('terms-modal');
    const openTermsBtn = document.getElementById('open-terms-modal');
    const closeTermsBtn = document.getElementById('close-terms-modal');

    if (openTermsBtn) {
        openTermsBtn.addEventListener('click', () => {
            termsModal.classList.remove('hidden');
            termsModal.classList.add('flex');
        });
    }

    if (closeTermsBtn) {
        closeTermsBtn.addEventListener('click', () => {
            termsModal.classList.add('hidden');
            termsModal.classList.remove('flex');
        });
    }

    // إغلاق عند النقر خارج الـ modal
    if (termsModal) {
        termsModal.addEventListener('click', (e) => {
            if (e.target === termsModal) {
                termsModal.classList.add('hidden');
                termsModal.classList.remove('flex');
            }
        });
    }
}

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
                    loadAdminData();
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
                // إخفاء الروابط/الأزرار التي يجب أن تظهر فقط لغير المسجلين
                document.getElementById('auth-links')?.classList.add('hidden');
                document.getElementById('user-links')?.classList.remove('hidden');

                if (path.endsWith('index.html') || path.endsWith('login.html') || path.endsWith('register.html')) {
                    // إذا كان مسجل الدخول، وجهه للداشبورد
                    redirectTo('dashboard.html');
                } else if (path.endsWith('dashboard.html')) {
                    loadDashboardData(user);
                    
                    // ربط زر المطالبة اليومية
                    const claimButton = document.getElementById('claim-daily-btn');
                    if (claimButton) claimButton.addEventListener('click', () => claimDailyPoints(user));
                    
                    // ربط زر النسخ
                    const copyBtn = document.getElementById('copy-referral-btn');
                    if (copyBtn) copyBtn.addEventListener('click', copyReferralCode);
                    
                    // منطق Modal التحويل
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
                // إظهار الروابط/الأزرار التي يجب أن تظهر فقط لغير المسجلين
                document.getElementById('auth-links')?.classList.remove('hidden');
                document.getElementById('user-links')?.classList.add('hidden');

                if (path.endsWith('dashboard.html') || path.endsWith('boosts.html')) {
                    // إذا حاول الدخول لصفحة تتطلب مصادقة، أعد التوجيه لصفحة البداية
                    redirectTo('index.html');
                }
            }
        });
    }

    // تهيئة الـ Modal في جميع الصفحات التي تحتوي على الزر
    setupTermsModal();


});
