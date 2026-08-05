import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Film, Loader2, ArrowRight } from "lucide-react";
import { loginUser } from "@/api.functions";
import { useEditor } from "@/store/editor";

export const Route = createFileRoute("/login")({
    head: () => ({ meta: [{ title: "Sign In — VertiCut" }] }),
    component: LoginPage,
});

function LoginPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!email || !password) {
            setError("Please fill in all fields.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            await loginUser({ data: { email, password } });
            // Clear store to reload correct isolated settings for user
            window.location.href = "/";
        } catch (err) {
            setError(String(err).replace("Error: ", ""));
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4 font-sans text-neutral-200">
            <div className="w-full max-w-[400px] space-y-6">
                <div className="flex flex-col items-center space-y-2 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-500 ring-1 ring-violet-500/20">
                        <Film className="h-5 w-5" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-white mt-3">Welcome back</h1>
                    <p className="text-xs text-neutral-400">
                        Enter your credentials to access your editor dashboard
                    </p>
                </div>

                <div className="space-y-4 rounded-2xl border border-neutral-800 bg-[#121214] p-6 shadow-xl shadow-black/40">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                Email Address
                            </label>
                            <input
                                id="email"
                                type="email"
                                required
                                disabled={loading}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="yours@example.com"
                                className="h-9 w-full rounded-lg border border-neutral-800 bg-[#161619] px-3 py-1 text-sm outline-none transition-all placeholder:text-neutral-600 text-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/30"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                    Password
                                </label>
                            </div>
                            <input
                                id="password"
                                type="password"
                                required
                                disabled={loading}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="h-9 w-full rounded-lg border border-neutral-800 bg-[#161619] px-3 py-1 text-sm outline-none transition-all placeholder:text-neutral-600 text-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/30"
                            />
                        </div>

                        {error && (
                            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                        >
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    Sign In <ArrowRight className="h-3.5 w-3.5" />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <div className="text-center text-xs text-neutral-500">
                    Don't have an account?{" "}
                    <Link to="/signup" className="font-medium text-violet-500 hover:underline">
                        Create an account
                    </Link>
                </div>
            </div>
        </div>
    );
}
