import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/AuthContext";
import { I18nProvider } from "./i18n";
import { Header, ProtectedRoute, ScrollToTop, RouteFallback } from "./components/shared";
import Footer from "./components/Footer";
import VerifyBanner from "./components/VerifyBanner";
import Paywall from "./components/Paywall";

/* Landing, Login and Register are the entry points for a first-time visitor,
   so they stay in the main chunk — code-splitting them would only add a round
   trip to the pages people arrive on. Everything else is loaded on demand.
   Before this, one 1.3 MB bundle shipped the admin panel, recharts and every
   exam screen to someone who had only opened the marketing page. */
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

const Pricing = lazy(() => import("./pages/Pricing"));
const VerifyAccount = lazy(() => import("./pages/VerifyAccount"));
const Practice = lazy(() => import("./pages/Practice"));
const SelectTask = lazy(() => import("./pages/SelectTask"));
const PracticeWrite = lazy(() => import("./pages/PracticeWrite"));
const SelectTheme = lazy(() => import("./pages/SelectTheme"));
const CheckWriting = lazy(() => import("./pages/CheckWriting"));
const ExamSimulator = lazy(() => import("./pages/ExamSimulator"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Review = lazy(() => import("./pages/Review"));
const RecentTopics = lazy(() => import("./pages/RecentTopics"));
const RecentTopicDetail = lazy(() =>
  import("./pages/RecentTopics").then((m) => ({ default: m.RecentTopicDetail })));
const MockExam = lazy(() => import("./pages/MockExam"));
const Admin = lazy(() => import("./pages/Admin"));
const BillingReturn = lazy(() => import("./pages/BillingReturn"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Combinations = lazy(() => import("./pages/Combinations"));
const ReadingHome = lazy(() => import("./pages/ReadingHome"));
const ReadingTests = lazy(() => import("./pages/ReadingTests"));
const ReadingTest = lazy(() => import("./pages/ReadingTest"));
const ListeningHome = lazy(() => import("./pages/ListeningHome"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const BlogAdmin = lazy(() => import("./pages/BlogAdmin"));
const Resources = lazy(() => import("./pages/Resources"));
const TefTcfWritingGuide = lazy(() => import("./pages/TefTcfWritingGuide"));
const SpeakingHome = lazy(() => import("./pages/SpeakingHome"));
const SpeakingTasks = lazy(() => import("./pages/SpeakingTasks"));
const SpeakingThemes = lazy(() => import("./pages/SpeakingThemes"));
const SpeakingRecord = lazy(() => import("./pages/SpeakingRecord"));
const SpeakingExam = lazy(() => import("./pages/SpeakingExam"));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const Contact = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Contact })));
const ForgotPassword = lazy(() => import("./pages/PasswordReset").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/PasswordReset").then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail")); 

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
      <AuthProvider>
        <ScrollToTop />
        <Header />
        <VerifyBanner />
        {/* Mounted once, above the routes: a spent allowance must be able to
            interrupt any page without that page knowing about billing. */}
        <Paywall />
        {/* One boundary around the routes: a per-route spinner would flash the
            header's own layout twice on every navigation. */}
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/practice" element={<Practice />} />
          {/* Specific /practice routes MUST come before /practice/:promptId */}
          <Route path="/practice/tasks" element={<SelectTask />} />
          <Route path="/practice/themes" element={<SelectTheme />} />
          <Route path="/practice/write" element={<PracticeWrite />} />
          <Route path="/practice/:promptId" element={<PracticeWrite />} />
          {/* Speaking flow — mirrors the writing flow; public like writing */}
          <Route path="/speaking" element={<SpeakingHome />} />
          <Route path="/speaking/tasks" element={<SpeakingTasks />} />
          <Route path="/speaking/themes" element={<SpeakingThemes />} />
          <Route path="/speaking/record" element={<SpeakingRecord />} />
          {/* Test Mode: the three tâches of one sitting, in exam order. */}
          <Route path="/speaking/test" element={<SpeakingExam />} />
          <Route path="/exam/:examType" element={<MockExam />} />
          <Route path="/recent-topics" element={<RecentTopics />} />
          <Route path="/recent-topics/:topicId" element={<RecentTopicDetail />} />
          <Route
            path="/check-writing"
            element={<ProtectedRoute><CheckWriting /></ProtectedRoute>}
          />
          <Route path="/resources" element={<Resources />} />
          <Route path="/reading" element={<ReadingHome />} />
          {/* Practice and test read the same papers; the mode decides whether a
              question is marked as it is answered or only at hand-in. */}
          <Route path="/reading/practice" element={<ReadingTests />} />
          <Route path="/reading/test" element={<ReadingTests />} />
          <Route path="/reading/practice/:testNumber" element={<ReadingTest />} />
          <Route path="/reading/test/:testNumber" element={<ReadingTest />} />
          <Route path="/listening" element={<ListeningHome />} />
          {/* ListeningHome linked to these two, but neither route existed, so
              both buttons fell through the catch-all to the landing page. The
              listening exam is the oral-comprehension mock. */}
          <Route path="/listening/practice" element={<Navigate to="/exam/oral-comprehension" replace />} />
          <Route path="/listening/test" element={<Navigate to="/exam/oral-comprehension" replace />} />
          {/* "Exam simulator" now means the SPEAKING exam. The writing
              simulator keeps its own path so the writing Test Mode still
              reaches a writing paper. */}
          <Route path="/exam-simulator" element={<SpeakingExam />} />
          <Route
            path="/practice/simulator"
            element={<ProtectedRoute><ExamSimulator /></ProtectedRoute>}
          />
          <Route path="/tef-tcf-writing-guide" element={<TefTcfWritingGuide />} />
          {/* Five "Methodology" buttons and the Resources FAQ card linked to
              these, but neither route existed, so all six fell through the
              catch-all to the landing page. The guide is that content. */}
          <Route path="/methodology" element={<Navigate to="/tef-tcf-writing-guide" replace />} />
          <Route path="/faq" element={<Navigate to="/tef-tcf-writing-guide#faq" replace />} />
          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          />
          <Route
            path="/review"
            element={<ProtectedRoute><Review /></ProtectedRoute>}
          />
          <Route
            path="/invoices"
            element={<ProtectedRoute><Invoices /></ProtectedRoute>}
          />
          <Route
            path="/feedback/:submissionId"
            element={<ProtectedRoute><Feedback /></ProtectedRoute>}
          />
          <Route path="/combinations" element={<Combinations />} />
          <Route
            path="/admin"
            element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>}
          />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/admin/blog" element={<ProtectedRoute adminOnly><BlogAdmin /></ProtectedRoute>} />
          {/* Where Cashfree returns the learner after the mandate. Protected:
              it reads the signed-in account's subscription. */}
          <Route path="/billing/return" element={<ProtectedRoute><BillingReturn /></ProtectedRoute>} />
          {/* Required before a payment processor will onboard the product, and
              linked from every page by the shared footer. */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          {/* Account recovery. Without these a forgotten password meant a dead
              account holding all of the learner's practice history. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/account/verify" element={<VerifyAccount />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        {/* Was defined inside Landing, so 31 of 32 routes ended with no
            navigation and no legal links at all. */}
        <Footer />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
