import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { setImpersonationToken } from './api';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminAccount, AdminAccounts, AdminAudit, AdminDashboard, AdminLayout, AdminLogin, AdminStaff, AdminTicket, AdminTickets } from './pages/admin/Admin';
import { ForgotPage, LoginPage, PublicOrderPage, RegisterPage, ResetPage } from './pages/AuthPages';
import AutomationPage, { RuleEditor } from './pages/automation/Automation';
import Dashboard from './pages/Dashboard';
import HelpPage, { ArticlePage, NewTicketPage, TicketPage } from './pages/help/HelpPages';
import AccelerationsPage from './pages/integrations/Accelerations';
import AddIntegration from './pages/integrations/AddIntegration';
import IntegrationSettings from './pages/integrations/IntegrationSettings';
import IntegrationsPage from './pages/integrations/IntegrationsPage';
import InvoicesPage from './pages/invoices/InvoicesPage';
import InvoiceView, { InvoiceNew } from './pages/invoices/InvoiceView';
import { LegalPage } from './pages/Legal';
import OffersPage from './pages/OffersPage';
import AddOrder from './pages/orders/AddOrder';
import OrderCard from './pages/orders/OrderCard';
import OrdersPage from './pages/orders/OrdersPage';
import CategoriesPage from './pages/products/CategoriesPage';
import ProductEdit from './pages/products/ProductEdit';
import ProductsPage from './pages/products/ProductsPage';
import { CatalogsPage, DocumentEditor, DocumentsPage, DocumentView, PriceGroupsPage, StocktakeView, StocktakingPage, WarehousesPage } from './pages/products/Warehouses';
import ReturnsPage, { ReturnDetail } from './pages/returns/ReturnsPage';
import SettingsPage from './pages/settings/SettingsPage';
import PackingPage from './pages/orders/PackingPage';
import ShipmentsPage from './pages/ShipmentsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Entry point of a support session opened from the admin panel (token in the URL fragment). */
function Impersonate() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/impersonate');
    if (token) setImpersonationToken(token);
    refresh();
    nav('/', { replace: true });
  }, [nav, refresh]);
  return <Loading />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPage />} />
      <Route path="/reset-password" element={<ResetPage />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/order/:account/:id/:token" element={<PublicOrderPage />} />
      <Route path="/impersonate" element={<Impersonate />} />

      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="accounts" element={<AdminAccounts />} />
        <Route path="accounts/:id" element={<AdminAccount />} />
        <Route path="tickets" element={<AdminTickets />} />
        <Route path="tickets/:id" element={<AdminTicket />} />
        <Route path="staff" element={<AdminStaff />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<AddOrder />} />
        <Route path="orders/packing" element={<PackingPage />} />
        <Route path="orders/:id" element={<OrderCard />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductEdit />} />
        <Route path="products/categories" element={<CategoriesPage />} />
        <Route path="products/warehouses" element={<WarehousesPage />} />
        <Route path="products/catalogs" element={<CatalogsPage />} />
        <Route path="products/documents" element={<DocumentsPage />} />
        <Route path="products/documents/new" element={<DocumentEditor />} />
        <Route path="products/documents/:id/edit" element={<DocumentEditor />} />
        <Route path="products/documents/:id" element={<DocumentView />} />
        <Route path="products/price-groups" element={<PriceGroupsPage />} />
        <Route path="products/stocktaking" element={<StocktakingPage />} />
        <Route path="products/stocktaking/:id" element={<StocktakeView />} />
        <Route path="products/:id" element={<ProductEdit />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="integrations/add" element={<AddIntegration />} />
        <Route path="integrations/accelerations" element={<AccelerationsPage />} />
        <Route path="integrations/:id" element={<IntegrationSettings />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<InvoiceNew />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="returns/:id" element={<ReturnDetail />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="automation/new" element={<RuleEditor />} />
        <Route path="automation/:id" element={<RuleEditor />} />
        <Route path="settings" element={<Navigate to="/settings/company" replace />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="help/article/:slug" element={<ArticlePage />} />
        <Route path="help/tickets/new" element={<NewTicketPage />} />
        <Route path="help/tickets/:id" element={<TicketPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
