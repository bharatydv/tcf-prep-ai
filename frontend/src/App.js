import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/AuthContext";
import { Header, ProtectedRoute } from "./components/shared";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Pricing from "./pages/Pricing";
import Practice from "./pages/Practice";
import SelectTask from "./pages/SelectTask";
import PracticeWrite from "./pages/PracticeWrite";
import SelectTheme from "./pages/SelectTheme";
import CheckWriting from "./pages/CheckWriting";
import ExamSimulator from "./pages/ExamSimulator";
import Feedback from "./pages/Feedback";
import Dashboard from "./pages/Dashboard";
import Review from "./pages/Review";
import RecentTopics, { RecentTopicDetail } from "./pages/RecentTopics";
import Speaking from "./pages/Speaking";
import MockExam from "./pages/MockExam";
import Admin from "./pages/Admin";
import Combinations from './pages/Combinations';

import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import BlogAdmin from './pages/BlogAdmin';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Header />
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
          <Route path="/speaking" element={<Speaking />} />
          <Route path="/exam/:examType" element={<MockExam />} />
          <Route path="/recent-topics" element={<RecentTopics />} />
          <Route path="/recent-topics/:topicId" element={<RecentTopicDetail />} />
          <Route
            path="/check-writing"
            element={<ProtectedRoute><CheckWriting /></ProtectedRoute>}
          />
          <Route
            path="/exam-simulator"
            element={<ProtectedRoute><ExamSimulator /></ProtectedRoute>}
          />
          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          />
          <Route
            path="/review"
            element={<ProtectedRoute><Review /></ProtectedRoute>}
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </BrowserRouter>
  );
}