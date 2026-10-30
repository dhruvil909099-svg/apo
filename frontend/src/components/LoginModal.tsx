import React, { useState, useEffect } from 'react';
import { X, Lock, User, Mail, ShieldCheck, AlertCircle, KeyRound, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: any) => void;
  initialMode?: 'LOGIN' | 'SETUP_ADMIN' | 'CHANGE_PASSWORD' | 'REGISTER';
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialMode = 'LOGIN'
}) => {
  const [mode, setMode] = useState<'LOGIN' | 'SETUP_ADMIN' | 'CHANGE_PASSWORD' | 'REGISTER'>(initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [initialSetupRequired, setInitialSetupRequired] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getBootstrapStatus()
        .then((status) => {
          if (status.initial_setup_required) {
            setInitialSetupRequired(true);
            setMode('SETUP_ADMIN');
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (mode === 'REGISTER' || mode === 'SETUP_ADMIN') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 10) {
        setError('Password must be at least 10 characters long with uppercase, lowercase, digit, and special symbol.');
        return;
      }
    }

    if (mode === 'CHANGE_PASSWORD') {
      if (newPassword !== confirmPassword) {
        setError('New password confirmation does not match.');
        return;
      }
      if (newPassword.length < 10) {
        setError('New password must be at least 10 characters long.');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (mode === 'LOGIN') {
        const res = await api.login(username.trim(), password);
        if (res.must_change_password) {
          setSuccessMsg('Authentication successful. Password rotation is required before accessing the dashboard.');
          setMode('CHANGE_PASSWORD');
          setCurrentPassword(password);
          setPassword('');
          setConfirmPassword('');
          return;
        }
        onLoginSuccess(res.user || { username: res.username, role: res.role });
        onClose();
      } else if (mode === 'SETUP_ADMIN') {
        const setupRes = await api.setupAdmin({
          username: username.trim(),
          email: email.trim(),
          password,
          confirm_password: confirmPassword,
        });
        setSuccessMsg('Initial administrator successfully provisioned! Secure session established.');
        setTimeout(() => {
          onLoginSuccess({ username: setupRes.username, role: setupRes.role });
          onClose();
        }, 800);
      } else if (mode === 'CHANGE_PASSWORD') {
        const chgRes = await api.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        });
        setSuccessMsg(chgRes.message || 'Password successfully updated.');
        setTimeout(() => {
          onLoginSuccess({ username, role: 'ADMIN' });
          onClose();
        }, 800);
      } else {
        const regRes = await api.register({
          username: username.trim(),
          email: email.trim(),
          password,
        });
        setSuccessMsg(regRes.message || 'Registration successful! You may now sign in.');
        setMode('LOGIN');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication request failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header bar */}
        <div className="bg-navy-900 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-600/30">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">IPOPro Authentication</h2>
              <p className="text-xs text-slate-400">Angel One Multi-Account Gateway</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold">
          {initialSetupRequired ? (
            <div className="flex-1 py-3 text-center border-b-2 border-brand-600 text-brand-600 bg-white font-bold">
              First-Run Administrator Setup
            </div>
          ) : mode === 'CHANGE_PASSWORD' ? (
            <div className="flex-1 py-3 text-center border-b-2 border-amber-600 text-amber-700 bg-white font-bold">
              Mandatory Password Rotation
            </div>
          ) : (
            <>
              <button
                onClick={() => { setMode('LOGIN'); setError(null); }}
                className={`flex-1 py-3 text-center transition-colors border-b-2 ${
                  mode === 'LOGIN'
                    ? 'border-brand-600 text-brand-600 bg-white font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setMode('REGISTER'); setError(null); }}
                className={`flex-1 py-3 text-center transition-colors border-b-2 ${
                  mode === 'REGISTER'
                    ? 'border-brand-600 text-brand-600 bg-white font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Register Operator
              </button>
            </>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {mode === 'CHANGE_PASSWORD' ? (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Current Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  New Secure Password (min 10 chars, upper/lower/digit/symbol)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {mode === 'SETUP_ADMIN' ? 'Initial Admin Username' : 'Username or Registered Email'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={mode === 'SETUP_ADMIN' ? 'admin' : 'e.g. operator or trader@domain.com'}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                  />
                </div>
              </div>

              {(mode === 'REGISTER' || mode === 'SETUP_ADMIN') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {mode === 'SETUP_ADMIN' ? 'Administrator Email' : 'Email Address'}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@ipopro.internal"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {mode === 'SETUP_ADMIN' ? 'Initial Admin Password (min 10 chars)' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                  />
                </div>
              </div>

              {(mode === 'REGISTER' || mode === 'SETUP_ADMIN') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : mode === 'LOGIN' ? (
              <>
                <span>Sign In to IPOPro</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : mode === 'SETUP_ADMIN' ? (
              <>
                <span>Provision Initial Administrator</span>
                <ShieldCheck className="w-4 h-4" />
              </>
            ) : mode === 'CHANGE_PASSWORD' ? (
              <>
                <span>Update Password & Continue</span>
                <ShieldCheck className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Create Operator Account</span>
                <ShieldCheck className="w-4 h-4" />
              </>
            )}
          </button>

          {/* Secure Session Guarantee */}
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Hardened Session Architecture</span>
            </p>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Zero hardcoded credentials. All sessions protected with HttpOnly SameSite cookies, CSRF validation, and PBKDF2 password derivation.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};
