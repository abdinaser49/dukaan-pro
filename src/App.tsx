import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bell,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  Ellipsis,
  FileBarChart,
  FileText,
  Filter,
  LayoutDashboard,
  Menu,
  Minus,
  Moon,
  Package,
  Plus,
  Printer,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  Tag,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Session } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { categories, type Contact, type Product, type Sale } from "./domain";
import { supabase } from "./lib/supabase";
import initialMigrationSql from "../supabase/migrations/202409280001_initial_schema.sql?raw";
import shopsAndUnitsMigrationSql from "../supabase/migrations/202409280002_shops_and_units.sql?raw";
import "./App.css";

type PageKey =
  | "Dashboard"
  | "POS"
  | "Products"
  | "Categories"
  | "Brands"
  | "Inventory"
  | "Purchases"
  | "Suppliers"
  | "Sales"
  | "Customers"
  | "Expenses"
  | "Employees"
  | "Cash Register"
  | "Reports"
  | "Accounting"
  | "Notifications"
  | "Audit Logs"
  | "Settings";
type CartItem = { product: Product; quantity: number };
type ProductForm = Omit<Product, "id">;
type CategoryRecord = { id: string; name: string };
type ImportStatus = "ready" | "missing" | "duplicate" | "invalid";
type ImportRow = {
  rowNumber: number;
  name: string;
  category: string;
  brand: string;
  cost: string;
  price: string;
  unit: string;
  barcode: string;
  sku: string;
  stock: string;
  minimum: string;
  supplier: string;
  description: string;
  status: ImportStatus;
  error: string;
  duplicateProductId?: string;
  duplicateChoice?: "skip" | "update" | "create";
};
type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  errors: { rowNumber: number; name: string; error: string }[];
};

const importHeaders = [
  "Product Name",
  "Category",
  "Brand",
  "Cost Price",
  "Sale Price",
  "Unit",
  "Barcode",
  "Initial Stock",
  "Minimum Stock",
  "Supplier",
  "Description",
];

const importFieldMap: Record<string, keyof ImportRow> = {
  "product name": "name",
  product: "name",
  name: "name",
  category: "category",
  brand: "brand",
  "cost price": "cost",
  "purchase price": "cost",
  cost: "cost",
  "sale price": "price",
  "retail price": "price",
  sale: "price",
  price: "price",
  unit: "unit",
  barcode: "barcode",
  "initial stock": "stock",
  "current stock": "stock",
  stock: "stock",
  "minimum stock": "minimum",
  "min stock": "minimum",
  supplier: "supplier",
  description: "description",
  sku: "sku",
};

function parseImportRows(data: unknown[][], products: Product[]): ImportRow[] {
  const [headers = [], ...body] = data;
  const normalizedHeaders = headers.map((header) =>
    String(header ?? "").trim().toLowerCase(),
  );
  const parsedRows = body
    .map((cells, index) => {
      const row = Object.fromEntries(
        normalizedHeaders.map((header, cellIndex) => [
          importFieldMap[header],
          String(cells[cellIndex] ?? "").trim(),
        ]),
      ) as Partial<ImportRow>;
      const cell = (cellIndex: number) => String(cells[cellIndex] ?? "").trim();
      const name = row.name || cell(0);
      const category = row.category || cell(1);
      const cost = row.cost || cell(2);
      const price = row.price || cell(3);
      const stock = row.stock || cell(4);
      const unit = row.unit || cell(5);
      const barcode = row.barcode || cell(6);
      const sku = row.sku || cell(7);
      const minimum = row.minimum ?? "";
      const existing = products.find(
        (product) =>
          (barcode && product.barcode === barcode) ||
          (sku && product.sku === sku) ||
          product.name.trim().toLowerCase() === name.toLowerCase(),
      );
      let status: ImportStatus = "ready";
      let error = "";
      if (!name || !price || !cost || !unit || !stock) {
        status = "missing";
        error = "Name, prices, unit and stock are required";
      } else if (
        !Number.isFinite(Number(price)) ||
        !Number.isFinite(Number(cost)) ||
        !Number.isFinite(Number(stock)) ||
        !Number.isFinite(Number(minimum))
      ) {
        status = "invalid";
        error = "Price, stock and minimum stock must be numbers";
      } else if (barcode && !/^[A-Za-z0-9_-]+$/.test(barcode)) {
        status = "invalid";
        error = "Barcode contains invalid characters";
      } else if (existing) {
        status = "duplicate";
        error = `${existing.name} already exists`;
      }
      return {
        rowNumber: index + 2,
        name,
        category: category || "Other",
        brand: row.brand ?? "",
        cost,
        price,
        unit,
        barcode,
        sku,
        stock,
        minimum,
        supplier: row.supplier ?? "",
        description: row.description ?? "",
        status,
        error,
        duplicateProductId: existing?.id,
        duplicateChoice: existing ? ("skip" as const) : undefined,
      };
    })
    .filter((row) => row.name || row.price || row.barcode);
  const seenNames = new Set<string>();
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();
  return parsedRows.map((row) => {
    const duplicateInFile =
      (row.name && seenNames.has(row.name.toLowerCase())) ||
      (row.barcode && seenBarcodes.has(row.barcode)) ||
      (row.sku && seenSkus.has(row.sku));
    if (row.name) seenNames.add(row.name.toLowerCase());
    if (row.barcode) seenBarcodes.add(row.barcode);
    if (row.sku) seenSkus.add(row.sku);
    return duplicateInFile && row.status === "ready"
      ? { ...row, status: "duplicate" as const, error: "Duplicate name or barcode in this file", duplicateChoice: "skip" as const }
      : row;
  });
}

const projectRef = import.meta.env.VITE_SUPABASE_URL?.match(
  /^https:\/\/([^.]+)\.supabase\.co$/,
)?.[1];
const sqlEditorUrl = projectRef
  ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
  : "https://supabase.com/dashboard";
const migrationSql = `${initialMigrationSql}\n\n${shopsAndUnitsMigrationSql}`;

function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessLocation, setBusinessLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName.trim(),
                business_name: businessName.trim(),
                business_location: businessLocation.trim(),
                phone: phone.trim(),
              },
            },
          });
    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setSuccess(
        "Account created. Check your email to confirm your address, then sign in.",
      );
    }
  };
  const resetPassword = async () => {
    if (!supabase || !email) {
      setError("Enter your email address first.");
      return;
    }
    const { error: authError } =
      await supabase.auth.resetPasswordForEmail(email);
    setError(
      authError ? authError.message : "Password reset link sent to your email.",
    );
  };
  return (
    <main className="auth-screen">
      <section className="auth-aside">
        <div className="auth-brand">
          <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
          <strong>
            DUKAAN <b>PRO</b>
          </strong>
        </div>
        <div className="auth-message">
          <span className="eyebrow">YOUR STORE, IN GOOD HANDS</span>
          <h1>
            Every detail.
            <br />
            Under control.
          </h1>
          <p>
            Sales, stock and store performance in one calm, connected workspace.
          </p>
        </div>
        <div className="auth-aside-bottom">
          <span className="footer-status" /> Secure store operations{" "}
          <span>·</span> Multi-branch ready
        </div>
      </section>
      <section className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">
            {mode === "signin" ? "WELCOME BACK" : "GET STARTED"}
          </span>
          <h2>
            {mode === "signin"
              ? "Sign in to your store"
              : "Create your account"}
          </h2>
          <p>
            {mode === "signin"
              ? "Use your team account to continue to DUKAAN PRO."
              : "Register your account to set up your store workspace."}
          </p>
          {mode === "signup" && (
            <label>
              Full name
              <input
                required
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          {mode === "signup" && (
            <label>
              Business name
              <input
                required
                autoComplete="organization"
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Your shop name"
              />
            </label>
          )}
          <label>
            Email address
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@yourstore.com"
            />
          </label>
          {mode === "signup" && (
            <>
              <label>
                Business location
                <input
                  required
                  autoComplete="street-address"
                  value={businessLocation}
                  onChange={(event) => setBusinessLocation(event.target.value)}
                  placeholder="City or address"
                />
              </label>
              <label>
                Phone number
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+252 …"
                />
              </label>
            </>
          )}
          <label>
            Password
            <input
              required
              type="password"
              minLength={8}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "signin"
                  ? "Enter your password"
                  : "At least 8 characters"
              }
            />
          </label>
          {mode === "signup" && (
            <label>
              Confirm password
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your password"
              />
            </label>
          )}
          {mode === "signin" && (
            <div className="auth-options">
              <label className="remember-option">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Remember me
              </label>
              <button type="button" onClick={resetPassword}>
                Forgot password?
              </button>
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <button
            className="button button-primary auth-submit"
            disabled={loading}
          >
            {loading
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
            <ArrowRight size={15} />
          </button>
          <div className="auth-switch">
            {mode === "signin"
              ? "New to Dukaan Pro?"
              : "Already have an account?"}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setSuccess("");
              }}
            >
              {mode === "signin" ? "Create account" : "Sign in"}
            </button>
          </div>
          <div className="auth-security">
            <ShieldCheck size={15} />
            Protected by Supabase Authentication
          </div>
        </form>
      </section>
    </main>
  );
}

const navGroups: {
  heading: string;
  items: { name: PageKey; icon: typeof LayoutDashboard }[];
}[] = [
  {
    heading: "WORKSPACE",
    items: [
      { name: "Dashboard", icon: LayoutDashboard },
      { name: "POS", icon: ShoppingCart },
    ],
  },
  {
    heading: "CATALOG",
    items: [
      { name: "Products", icon: Package },
      { name: "Categories", icon: Boxes },
      { name: "Brands", icon: Tag },
      { name: "Inventory", icon: Activity },
    ],
  },
  {
    heading: "OPERATIONS",
    items: [
      { name: "Purchases", icon: ShoppingBag },
      { name: "Suppliers", icon: Truck },
      { name: "Sales", icon: FileText },
      { name: "Customers", icon: Users },
      { name: "Expenses", icon: Wallet },
    ],
  },
  {
    heading: "MANAGEMENT",
    items: [
      { name: "Employees", icon: BriefcaseBusiness },
      { name: "Cash Register", icon: Banknote },
      { name: "Reports", icon: FileBarChart },
      { name: "Accounting", icon: CreditCard },
      { name: "Notifications", icon: Bell },
      { name: "Audit Logs", icon: ShieldCheck },
    ],
  },
];

const getSalesChartData = (sales: Sale[]) =>
  [...sales].reverse().map((sale, index) => ({
    day: sale.date || `Sale ${index + 1}`,
    revenue: sale.total,
  }));

const money = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(`dukaan-${key}`);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const readRecords = <T extends { id: string }>(key: string): T[] => {
  const cleanupKey = "dukaan-legacy-demo-data-removed";
  if (localStorage.getItem(cleanupKey) !== "true") {
    ["products", "sales", "customers", "suppliers"].forEach((recordKey) =>
      localStorage.removeItem(`dukaan-${recordKey}`),
    );
    localStorage.setItem(cleanupKey, "true");
  }
  return readStore<T[]>(key, []);
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image could not be read"));
    reader.onerror = () => reject(new Error("Image could not be read"));
    reader.readAsDataURL(file);
  });

function ProductPhoto({
  product,
  large = false,
}: {
  product: Product;
  large?: boolean;
}) {
  return (
    <div className={`product-photo${large ? " product-photo-large" : ""}`}>
      <img
        src={product.image}
        alt={product.name}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.opacity = "0";
        }}
      />
      <span>{product.name.slice(0, 1)}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  foot,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  tone: string;
  foot: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${tone}`}>
          <Icon size={17} />
        </span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        <span>{foot}</span>
      </div>
    </article>
  );
}

function ProductDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product | null;
  onClose: () => void;
  onSave: (
    value: ProductForm,
    id?: string,
    imageFile?: File | null,
    removeImage?: boolean,
  ) => void;
}) {
  const [form, setForm] = useState<ProductForm>(
    product
      ? { ...product }
      : {
          name: "",
          sku: "",
          barcode: "",
          category: "Drinks",
          price: 0,
          cost: 0,
          stock: 0,
          minimum: 8,
          image: "",
          unit: "Each",
        },
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(form.image);
  const [imageError, setImageError] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const set = (key: keyof ProductForm, value: string | number) =>
    setForm((current) => ({ ...current, [key]: value }));
  const chooseImage = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImageError("Image must be 2 MB or smaller.");
      return;
    }
    setImageError("");
    setImageFile(file);
    setRemoveImage(false);
    setPreview(URL.createObjectURL(file));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(form, product?.id, imageFile, removeImage);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="modal product-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">PRODUCT CATALOG</span>
            <h2>{product ? "Edit product" : "Add a product"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <label>
          Product name
          <input
            required
            autoFocus
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Orange juice"
          />
        </label>
        <div className="form-grid">
          <label>
            SKU
            <input
              required
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="DRK-013"
            />
          </label>
          <label>
            Barcode
            <input
              value={form.barcode}
              onChange={(e) => set("barcode", e.target.value)}
              placeholder="Scan or type barcode"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {categories.slice(1).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <input
              value={form.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="Each, 500 ml..."
            />
          </label>
        </div>
        <div className="form-grid three-col">
          <label>
            Cost price
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.cost}
              onChange={(e) => set("cost", Number(e.target.value))}
            />
          </label>
          <label>
            Selling price
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.price}
              onChange={(e) => set("price", Number(e.target.value))}
            />
          </label>
          <label>
            {product ? "Current stock" : "Opening stock"}
            <input
              type="number"
              min="0"
              required
              disabled={Boolean(product)}
              value={form.stock}
              onChange={(e) => set("stock", Number(e.target.value))}
            />
          </label>
        </div>
        <div className="form-grid image-form-grid">
          <label>
            Low stock alert
            <input
              type="number"
              min="0"
              value={form.minimum}
              onChange={(e) => set("minimum", Number(e.target.value))}
            />
          </label>
          <div className="image-upload-field">
            <span className="field-label">Product image</span>
            <input
              ref={imageInput}
              className="visually-hidden-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => chooseImage(event.currentTarget.files?.[0])}
            />
            {preview ? (
              <div className="image-upload-preview">
                <img src={preview} alt="Product preview" />
                <div>
                  <strong>{imageFile?.name ?? "Product image"}</strong>
                  <span>
                    {imageFile
                      ? `${(imageFile.size / 1024).toFixed(0)} KB`
                      : "Current image"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="image-upload-empty">
                <Package size={17} />
                <span>No image selected</span>
              </div>
            )}
            <div className="image-upload-actions">
              <button
                type="button"
                className="button button-white"
                onClick={() => imageInput.current?.click()}
              >
                {preview ? "Replace image" : "Upload image"}
              </button>
              {preview && (
                <button
                  type="button"
                  className="image-remove-button"
                  onClick={() => {
                    setPreview("");
                    setImageFile(null);
                    setRemoveImage(true);
                    setImageError("");
                    if (imageInput.current) imageInput.current.value = "";
                  }}
                >
                  Remove
                </button>
              )}
              <span>JPG, PNG or WebP · 2 MB max</span>
            </div>
            {imageError && (
              <span className="image-upload-error">{imageError}</span>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={15} />
            Save product
          </button>
        </div>
      </form>
    </div>
  );
}

function StockDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product;
  onClose: () => void;
  onSave: (quantity: number, reason: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("Stock count correction");
  return (
    <div className="modal-backdrop">
      <section className="modal stock-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">INVENTORY CONTROL</span>
            <h2>Adjust stock</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="adjust-product">
          <ProductPhoto product={product} />
          <div>
            <strong>{product.name}</strong>
            <span>
              {product.sku} · Current stock {product.stock}
            </span>
          </div>
        </div>
        <label>
          Change in quantity{" "}
          <span className="muted">(use a minus sign to remove stock)</span>
          <input
            type="number"
            autoFocus
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 12 or -2"
          />
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {[
              "Stock count correction",
              "Damaged goods",
              "Expired goods",
              "Internal use",
              "Lost stock",
              "New delivery",
              "Other",
            ].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={!quantity || Number(quantity) === 0}
            onClick={() => onSave(Number(quantity), reason)}
          >
            Save adjustment
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [cloudBranchId, setCloudBranchId] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(!supabase);
  const [cloudError, setCloudError] = useState("");
  const [migrationCopyStatus, setMigrationCopyStatus] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [cloudRevision, setCloudRevision] = useState(0);
  const [products, setProducts] = useState<Product[]>(() =>
    readRecords("products"),
  );
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>(
    categories
      .filter((item) => item !== "All items")
      .map((name) => ({ id: `local-${name}`, name })),
  );
  const [sales, setSales] = useState<Sale[]>(() => readRecords("sales"));
  const [customers] = useState<Contact[]>(() => readRecords("customers"));
  const [suppliers] = useState<Contact[]>(() => readRecords("suppliers"));
  const [page, setPage] = useState<PageKey>("Dashboard");
  const [dark, setDark] = useState(() => readStore("dark", false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All items");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState("Cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [toast, setToast] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [productDialog, setProductDialog] = useState<
    Product | null | undefined
  >(undefined);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [salesSearch, setSalesSearch] = useState("");
  const [period, setPeriod] = useState("This week");
  const [heldSales, setHeldSales] = useState<CartItem[][]>([]);
  const [lastReceipt, setLastReceipt] = useState<Sale | null>(null);
  const [branch, setBranch] = useState("Unassigned branch");
  const [language, setLanguage] = useState("EN");
  const [audit, setAudit] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCloudReady(!data.session);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCloudBranchId(null);
      setCloudReady(!nextSession);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!client || !session) return;
    let cancelled = false;
    const loadBranchData = async () => {
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("branch_id")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profileError) {
        setCloudError(profileError.message);
        setCloudReady(true);
        return;
      }
      setCloudError("");
      if (!profile?.branch_id) {
        const signupBusiness = session.user.user_metadata?.business_name;
        if (typeof signupBusiness === "string" && signupBusiness.trim()) {
          const { data: provisionedBranch, error: provisionError } =
            await client.rpc("provision_shop_from_signup");
          if (cancelled) return;
          if (provisionError) {
            setCloudError(provisionError.message);
            setCloudReady(true);
            return;
          }
          setCloudReady(false);
          setCloudBranchId(provisionedBranch);
          setCloudRevision((revision) => revision + 1);
          return;
        }
        setCloudReady(true);
        return;
      }
      const branchId = profile.branch_id;
      setCloudBranchId(branchId);
      const [
        productResult,
        inventoryResult,
        categoryResult,
        saleResult,
        branchResult,
      ] = await Promise.all([
        client
          .from("products")
          .select(
            "id,name,sku,barcode,unit,cost_price,selling_price,minimum_stock,image_path,category_id",
          )
          .eq("branch_id", branchId)
          .is("archived_at", null),
        client
          .from("inventory")
          .select("product_id,quantity")
          .eq("branch_id", branchId),
        client.from("categories").select("id,name").eq("branch_id", branchId),
        client
          .from("sales")
          .select(
            "id,invoice_number,total,payment_method,sold_at,status,cost_total",
          )
          .eq("branch_id", branchId)
          .is("archived_at", null)
          .order("sold_at", { ascending: false })
          .limit(100),
        client.from("branches").select("name").eq("id", branchId).maybeSingle(),
      ]);
      if (cancelled) return;
      const inventory = new Map(
        (inventoryResult.data ?? []).map((row) => [
          row.product_id,
          Number(row.quantity),
        ]),
      );
      const categoryNames = new Map(
        (categoryResult.data ?? []).map((row) => [row.id, row.name]),
      );
      if (categoryResult.error) {
        setCloudError(categoryResult.error.message);
        setCloudReady(true);
        return;
      }
      let branchCategories = categoryResult.data ?? [];
      if (!branchCategories.length) {
        const defaultCategories = [
          "Food",
          "Drinks",
          "Cleaning",
          "Personal Care",
          "Household",
          "Cosmetics",
          "Baby Products",
          "Other",
        ];
        const { data: seededCategories, error: seedError } = await client
          .from("categories")
          .upsert(
            defaultCategories.map((name) => ({
              branch_id: branchId,
              name,
            })),
            { onConflict: "branch_id,name" },
          )
          .select("id,name");
        if (seedError) {
          setCloudError(seedError.message);
          setCloudReady(true);
          return;
        }
        branchCategories = seededCategories ?? [];
      }
      setCategoryRecords(branchCategories);
      if (productResult.data)
        setProducts(
          await Promise.all(
            productResult.data.map(async (row) => {
              const { data: signedImage } = row.image_path
                ? await client.storage
                    .from("product-images")
                    .createSignedUrl(row.image_path, 3600)
                : { data: null };
              return {
                id: row.id,
                name: row.name,
                sku: row.sku,
                barcode: row.barcode ?? "",
                category: categoryNames.get(row.category_id ?? "") ?? "Other",
                price: Number(row.selling_price),
                cost: Number(row.cost_price),
                stock: inventory.get(row.id) ?? 0,
                minimum: Number(row.minimum_stock),
                image: signedImage?.signedUrl ?? "",
                imagePath: row.image_path ?? undefined,
                unit: row.unit,
              };
            }),
          ),
        );
      else setProducts([]);
      if (saleResult.data)
        setSales(
          saleResult.data.map((row) => ({
            id: row.id,
            invoice: row.invoice_number,
            customer: "Store customer",
            cashier: "Team member",
            total: Number(row.total),
            payment: row.payment_method.replaceAll("_", " "),
            date: new Date(row.sold_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            status: row.status === "completed" ? "Paid" : "Pending",
            profit: Number(row.total) - Number(row.cost_total),
          })),
        );
      else setSales([]);
      if (branchResult.data?.name)
        setBranch(`${branchResult.data.name} · branch`);
      setCloudReady(true);
    };
    void loadBranchData();
    return () => {
      cancelled = true;
    };
  }, [session, cloudRevision]);
  useEffect(() => {
    const client = supabase;
    if (!client || !cloudBranchId) return;
    const channel = client
      .channel(`dukaan-${cloudBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `branch_id=eq.${cloudBranchId}`,
        },
        () => setCloudRevision((value) => value + 1),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
          filter: `branch_id=eq.${cloudBranchId}`,
        },
        () => setCloudRevision((value) => value + 1),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales",
          filter: `branch_id=eq.${cloudBranchId}`,
        },
        () => setCloudRevision((value) => value + 1),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [cloudBranchId]);
  useEffect(() => {
    localStorage.setItem("dukaan-products", JSON.stringify(products));
  }, [products]);
  useEffect(() => {
    localStorage.setItem("dukaan-sales", JSON.stringify(sales));
  }, [sales]);
  useEffect(() => {
    localStorage.setItem("dukaan-dark", JSON.stringify(dark));
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (category === "All items" || product.category === category) &&
          `${product.name} ${product.sku} ${product.barcode}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [products, category, query],
  );
  const cartSubtotal = cart.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );
  const cartTax = cartSubtotal * 0.05;
  const cartTotal = cartSubtotal + cartTax;
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const lowStock = products.filter(
    (product) => product.stock <= product.minimum,
  ).length;
  const salesTotal = sales.reduce((total, sale) => total + sale.total, 0);
  const profitsTotal = sales.reduce((total, sale) => total + sale.profit, 0);
  const visibleSales = sales.filter((sale) =>
    `${sale.invoice} ${sale.customer} ${sale.cashier}`
      .toLowerCase()
      .includes(salesSearch.toLowerCase()),
  );

  const notify = (message: string) => setToast(message);
  const createFirstBranch = async () => {
    const client = supabase;
    const name = newBranchName.trim();
    if (!client || !name) return;
    setCreatingBranch(true);
    setCloudError("");
    const { data, error } = await client.rpc("bootstrap_first_branch", {
      p_branch_name: name,
    });
    setCreatingBranch(false);
    if (error) {
      setCloudError(error.message);
      return;
    }
    setCloudReady(false);
    setCloudBranchId(data);
    setCloudRevision((revision) => revision + 1);
  };
  const createCategory = async (name: string) => {
    const client = supabase;
    const normalizedName = name.trim();
    if (!client || !cloudBranchId || !normalizedName) return false;
    const { data, error } = await client
      .from("categories")
      .insert({ branch_id: cloudBranchId, name: normalizedName })
      .select("id,name")
      .single();
    if (error) {
      notify(`Category was not saved: ${error.message}`);
      return false;
    }
    setCategoryRecords((items) =>
      items.some((item) => item.name === normalizedName)
        ? items
        : [...items, data ?? { id: crypto.randomUUID(), name: normalizedName }],
    );
    setCloudRevision((revision) => revision + 1);
    notify("Category added");
    return true;
  };
  const updateCategory = async (id: string, name: string) => {
    const client = supabase;
    const normalizedName = name.trim();
    if (!client || !cloudBranchId || !normalizedName) return false;
    const { data, error } = await client
      .from("categories")
      .update({ name: normalizedName })
      .eq("id", id)
      .eq("branch_id", cloudBranchId)
      .select("id,name")
      .single();
    if (error) {
      notify(`Category was not updated: ${error.message}`);
      return false;
    }
    setCategoryRecords((items) => items.map((item) => (item.id === id ? data : item)));
    setCloudRevision((revision) => revision + 1);
    notify("Category updated");
    return true;
  };
  const deleteCategory = async (id: string) => {
    const client = supabase;
    if (!client || !cloudBranchId) return false;
    const { error } = await client
      .from("categories")
      .delete()
      .eq("id", id)
      .eq("branch_id", cloudBranchId);
    if (error) {
      notify(`Category was not deleted: ${error.message}`);
      return false;
    }
    setCategoryRecords((items) => items.filter((item) => item.id !== id));
    setCloudRevision((revision) => revision + 1);
    notify("Category deleted");
    return true;
  };
  const copyMigrationSql = async () => {
    try {
      await navigator.clipboard.writeText(migrationSql);
      setMigrationCopyStatus(
        "Migration SQL copied. Paste it into SQL Editor and click Run.",
      );
    } catch {
      setMigrationCopyStatus(
        "Copy was blocked. Open the migration file in the workspace and copy its contents.",
      );
    }
  };
  const logAction = (message: string) =>
    setAudit((items) => [message, ...items].slice(0, 15));
  const addToCart = (product: Product) => {
    if (product.stock < 1) {
      notify("This item is out of stock");
      return;
    }
    setCart((items) => {
      const match = items.find((item) => item.product.id === product.id);
      if (match && match.quantity >= product.stock) {
        notify("Available stock limit reached");
        return items;
      }
      return match
        ? items.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          )
        : [...items, { product, quantity: 1 }];
    });
  };
  const updateQuantity = (id: string, amount: number) =>
    setCart((items) =>
      items.flatMap((item) =>
        item.product.id !== id
          ? [item]
          : item.quantity + amount <= 0
            ? []
            : [
                {
                  ...item,
                  quantity: Math.min(
                    item.quantity + amount,
                    item.product.stock,
                  ),
                },
              ],
      ),
    );
  const saveProduct = async (
    form: ProductForm,
    id?: string,
    imageFile?: File | null,
    removeImage = false,
  ) => {
    const client = supabase;
    let savedId = id;
    let savedForm = { ...form };
    if (client && cloudBranchId) {
      const productId = id ?? crypto.randomUUID();
      let imagePath = removeImage ? null : (form.imagePath ?? null);
      let uploadedPath: string | null = null;
      if (imageFile) {
        const extension =
          { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
            imageFile.type
          ] ?? "img";
        uploadedPath = `${cloudBranchId}/${productId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage
          .from("product-images")
          .upload(uploadedPath, imageFile, {
            contentType: imageFile.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) {
          notify(`Image upload failed: ${uploadError.message}`);
          return;
        }
        imagePath = uploadedPath;
      }
      const { data: categoryRecord } = await client
        .from("categories")
        .select("id")
        .eq("branch_id", cloudBranchId)
        .eq("name", form.category)
        .maybeSingle();
      const productValues = {
        branch_id: cloudBranchId,
        category_id: categoryRecord?.id ?? null,
        name: form.name,
        sku: form.sku,
        barcode: form.barcode || null,
        unit: form.unit,
        cost_price: form.cost,
        selling_price: form.price,
        minimum_stock: form.minimum,
        image_path: imagePath,
      };
      if (id) {
        const { error } = await client
          .from("products")
          .update(productValues)
          .eq("id", id)
          .eq("branch_id", cloudBranchId);
        if (error) {
          if (uploadedPath)
            await client.storage.from("product-images").remove([uploadedPath]);
          notify(`Product was not saved: ${error.message}`);
          return;
        }
        const oldImagePath = form.imagePath;
        if (
          (removeImage || imageFile) &&
          oldImagePath &&
          oldImagePath !== imagePath
        )
          await client.storage.from("product-images").remove([oldImagePath]);
        savedId = id;
      } else {
        const { data, error } = await client
          .from("products")
          .insert({ ...productValues, id: productId })
          .select("id")
          .single();
        if (error) {
          if (uploadedPath)
            await client.storage.from("product-images").remove([uploadedPath]);
          notify(`Product was not saved: ${error.message}`);
          return;
        }
        savedId = data.id;
        const { error: inventoryError } = await client
          .from("inventory")
          .insert({
            branch_id: cloudBranchId,
            product_id: data.id,
            quantity: form.stock,
            warehouse: "Main warehouse",
          });
        if (inventoryError) {
          notify(
            `Product created, but opening stock was not saved: ${inventoryError.message}`,
          );
          return;
        }
      }
      const { data: signedImage } = imagePath
        ? await client.storage
            .from("product-images")
            .createSignedUrl(imagePath, 3600)
        : { data: null };
      savedForm = {
        ...form,
        image: signedImage?.signedUrl ?? "",
        imagePath: imagePath ?? undefined,
      };
    } else if (imageFile || removeImage) {
      try {
        savedForm = {
          ...form,
          image: imageFile ? await fileToDataUrl(imageFile) : "",
          imagePath: undefined,
        };
      } catch {
        notify("Image could not be saved. Please try another file.");
        return;
      }
    }
    if (savedId) {
      setProducts((items) =>
        items.map((item) =>
          item.id === savedId
            ? { ...savedForm, stock: item.stock, id: savedId! }
            : item,
        ),
      );
      logAction(`Product ${form.name} was updated`);
    } else {
      const created = { ...savedForm, id: `p-${Date.now()}` };
      setProducts((items) => [created, ...items]);
      logAction(`Product ${form.name} was created`);
    }
    setProductDialog(undefined);
    notify(id ? "Product changes saved" : "Product added to catalog");
  };
  const saveAdjustment = async (amount: number, reason: string) => {
    if (!stockProduct) return;
    if (stockProduct.stock + amount < 0) {
      notify("Adjustment cannot reduce stock below zero");
      return;
    }
    let nextStock = stockProduct.stock + amount;
    if (supabase && cloudBranchId) {
      const { data, error } = await supabase.rpc("adjust_inventory", {
        p_branch_id: cloudBranchId,
        p_product_id: stockProduct.id,
        p_quantity_delta: amount,
        p_reason: reason,
      });
      if (error) {
        notify(`Adjustment was not saved: ${error.message}`);
        return;
      }
      nextStock = Number(data);
    }
    const updated = { ...stockProduct, stock: nextStock };
    setProducts((items) =>
      items.map((item) => (item.id === stockProduct.id ? updated : item)),
    );
    logAction(
      `${reason}: ${stockProduct.name} ${amount > 0 ? "+" : ""}${amount} units`,
    );
    setStockProduct(null);
    notify("Inventory adjustment recorded");
  };
  const importProducts = async (
    rows: ImportRow[],
    onProgress: (completed: number, total: number) => void,
  ): Promise<ImportResult> => {
    const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
    if (!supabase || !cloudBranchId) {
      return { ...result, failed: rows.length, errors: rows.map((row) => ({ rowNumber: row.rowNumber, name: row.name, error: "Supabase branch is not connected" })) };
    }
    for (const [index, row] of rows.entries()) {
      onProgress(index, rows.length);
      if (row.status === "missing" || row.status === "invalid") {
        result.failed += 1;
        result.errors.push({ rowNumber: row.rowNumber, name: row.name, error: row.error });
        continue;
      }
      if (row.status === "duplicate" && row.duplicateChoice === "skip") {
        result.skipped += 1;
        continue;
      }
      try {
        const { data: category } = await supabase
          .from("categories")
          .select("id")
          .eq("branch_id", cloudBranchId)
          .eq("name", row.category || "Other")
          .maybeSingle();
        const productId =
          row.duplicateChoice === "update" && row.duplicateProductId
            ? row.duplicateProductId
            : crypto.randomUUID();
        let productSku = row.sku || `IMP-${row.barcode || productId.slice(0, 8)}`;
        if (row.duplicateChoice !== "update") {
          const { data: skuMatch } = await supabase
            .from("products")
            .select("id")
            .eq("branch_id", cloudBranchId)
            .eq("sku", productSku)
            .maybeSingle();
          if (skuMatch) productSku = `${productSku}-${productId.slice(0, 8)}`;
        }
        const productValues = {
          branch_id: cloudBranchId,
          category_id: category?.id ?? null,
          name: row.name,
          sku: productSku,
          barcode: row.barcode || null,
          unit: row.unit,
          cost_price: Number(row.cost),
          selling_price: Number(row.price),
          minimum_stock: Number(row.minimum || 0),
        };
        let saved: { id: string } | null = null;
        let saveError: { message: string } | null = null;
        if (row.duplicateChoice === "update") {
          const response = await supabase
            .from("products")
            .update(productValues)
            .eq("id", productId)
            .eq("branch_id", cloudBranchId)
            .select("id")
            .single();
          saved = response.data;
          saveError = response.error;
        } else {
          const response = await supabase
            .from("products")
            .insert({ ...productValues, id: productId })
            .select("id")
            .single();
          saved = response.data;
          saveError = response.error;
          if (saveError?.message.includes("products_branch_id_sku_key")) {
            const retryValues = {
              ...productValues,
              sku: `${productSku}-${crypto.randomUUID().slice(0, 8)}`,
            };
            const retry = await supabase
              .from("products")
              .insert({ ...retryValues, id: productId })
              .select("id")
              .single();
            saved = retry.data;
            saveError = retry.error;
          }
        }
        if (saveError || !saved) throw new Error(saveError?.message ?? "Product was not saved");
        const { data: inventory } = await supabase
          .from("inventory")
          .select("id")
          .eq("branch_id", cloudBranchId)
          .eq("product_id", saved.id)
          .eq("warehouse", "Main warehouse")
          .maybeSingle();
        const inventoryResult = inventory
          ? await supabase
              .from("inventory")
              .update({ quantity: Number(row.stock), updated_at: new Date().toISOString() })
              .eq("id", inventory.id)
          : await supabase.from("inventory").insert({
              branch_id: cloudBranchId,
              product_id: saved.id,
              quantity: Number(row.stock),
              warehouse: "Main warehouse",
            });
        if (inventoryResult.error) throw new Error(inventoryResult.error.message);
        result.imported += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ rowNumber: row.rowNumber, name: row.name, error: error instanceof Error ? error.message : "Unknown import error" });
      }
    }
    onProgress(rows.length, rows.length);
    setCloudRevision((revision) => revision + 1);
    return result;
  };
  const completeSale = async () => {
    if (!cart.length) {
      notify("Add at least one item to complete a sale");
      return;
    }
    if (payment === "Cash" && Number(amountReceived || cartTotal) < cartTotal) {
      notify("Amount received is less than the sale total");
      return;
    }
    let cloudSale: { id?: string; invoice_number?: string } | null = null;
    if (supabase && session && cloudBranchId) {
      const { data, error } = await supabase.rpc("record_sale", {
        p_branch_id: cloudBranchId,
        p_customer_id: null,
        p_payment_method: payment.toLowerCase().replaceAll(" ", "_"),
        p_amount_received: Number(amountReceived || cartTotal),
        p_items: cart.map(({ product, quantity }) => ({
          product_id: product.id,
          quantity,
          discount: 0,
        })),
      });
      if (error) {
        notify(`Sale was not saved: ${error.message}`);
        return;
      }
      cloudSale = data;
    }
    const now = new Date();
    const invoice =
      cloudSale?.invoice_number ??
      `INV-${now.toISOString().slice(2, 10).replaceAll("-", "")}-${String(sales.length + 82).padStart(3, "0")}`;
    const sale: Sale = {
      id: cloudSale?.id ?? `s-${Date.now()}`,
      invoice,
      customer: "Walk-in customer",
      cashier: session?.user.email?.split("@")[0] ?? "Store user",
      total: Number(cartTotal.toFixed(2)),
      payment,
      date: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "Paid",
      profit: Number(
        cart
          .reduce(
            (total, item) =>
              total + (item.product.price - item.product.cost) * item.quantity,
            0,
          )
          .toFixed(2),
      ),
    };
    setProducts((items) =>
      items.map((product) => {
        const line = cart.find((item) => item.product.id === product.id);
        return line
          ? { ...product, stock: product.stock - line.quantity }
          : product;
      }),
    );
    setSales((items) => [sale, ...items]);
    setLastReceipt(sale);
    setCart([]);
    setAmountReceived("");
    logAction(`Sale ${invoice} completed for ${money(sale.total)}`);
    notify(`Sale complete · ${invoice}`);
  };
  const exportSales = () => {
    const rows = [
      ["Invoice", "Customer", "Cashier", "Total", "Payment", "Time", "Profit"],
      ...visibleSales.map((sale) => [
        sale.invoice,
        sale.customer,
        sale.cashier,
        sale.total.toFixed(2),
        sale.payment,
        sale.date,
        sale.profit.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((field) => `"${String(field).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "dukaan-sales.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Sales report exported");
  };

  const switchPage = (nextPage: PageKey) => {
    setPage(nextPage);
    setMobileOpen(false);
    setQuery("");
  };
  const pageMeta: Record<PageKey, [string, string]> = {
    Dashboard: [
      "Store overview",
      "Your branch activity, from connected records.",
    ],
    POS: ["Point of sale", "Build a basket and check out your customer."],
    Products: [
      "Product catalog",
      "Manage your products, prices and availability.",
    ],
    Categories: [
      "Categories",
      "Keep your catalog organized for faster checkout.",
    ],
    Brands: ["Brands", "Manage the brands across your product range."],
    Inventory: [
      "Inventory control",
      "Track stock levels and record every adjustment.",
    ],
    Purchases: ["Purchases", "Track supplier orders and incoming stock."],
    Suppliers: [
      "Suppliers",
      "Keep supplier contacts and balances in one place.",
    ],
    Sales: [
      "Sales history",
      "Review completed transactions and export your records.",
    ],
    Customers: [
      "Customers",
      "Understand customer activity and outstanding balances.",
    ],
    Expenses: ["Expenses", "Keep day-to-day operating costs visible."],
    Employees: ["Team members", "Manage store access and employee activity."],
    "Cash Register": [
      "Cash register",
      "Reconcile your till at the end of each shift.",
    ],
    Reports: [
      "Reports & analytics",
      "Explore store performance and export your data.",
    ],
    Accounting: [
      "Accounting overview",
      "A clear view of revenue, costs and profit.",
    ],
    Notifications: [
      "Notifications",
      "Important updates from across your store.",
    ],
    "Audit Logs": [
      "Activity log",
      "A traceable record of important store actions.",
    ],
    Settings: ["Store settings", "Manage your business preferences."],
  };

  if (supabase && authLoading)
    return (
      <main className="auth-loading">
        <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
        <span>Loading your secure workspace…</span>
      </main>
    );
  if (supabase && !session) return <LoginScreen />;
  if (supabase && session && !cloudReady)
    return (
      <main className="auth-loading">
        <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
        <span>Loading your branch data…</span>
      </main>
    );
  if (
    supabase &&
    session &&
    cloudError &&
    /schema cache|could not find the table|does not exist|relation .* not exist/i.test(
      cloudError,
    )
  )
    return (
      <main className="auth-loading">
        <div className="branch-setup-message">
          <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
          <strong>Database setup is required</strong>
          <span>
            Supabase sign-in worked, but the Dukaan tables are not installed.
            Copy the migration, run it in SQL Editor, then reload this page.
          </span>
          <div className="migration-actions">
            <button
              className="button button-primary"
              onClick={() => void copyMigrationSql()}
            >
              {migrationCopyStatus.startsWith("Migration SQL copied")
                ? "SQL copied"
                : "Copy migration SQL"}
            </button>
            <a
              className="button button-white"
              href={sqlEditorUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open SQL Editor
            </a>
          </div>
          {migrationCopyStatus && (
            <span className="migration-copy-status">{migrationCopyStatus}</span>
          )}
          <button
            className="button button-white"
            onClick={() => void supabase?.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  if (supabase && session && !cloudBranchId)
    return (
      <main className="auth-loading">
        <div className="branch-setup-message">
          <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
          <strong>Set up your first branch</strong>
          <span>
            Create a branch for this store. This first-time setup is available
            only while the database has no branches. If branches already exist,
            ask an administrator to assign your account to one.
          </span>
          {cloudError && (
            <span className="branch-setup-error">{cloudError}</span>
          )}
          <label className="branch-name-field">
            Branch name
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="e.g. Main branch"
            />
          </label>
          <button
            className="button button-primary"
            disabled={!newBranchName.trim() || creatingBranch}
            onClick={() => void createFirstBranch()}
          >
            {creatingBranch ? "Creating branch…" : "Create branch"}
          </button>
          <button
            className="button button-white"
            onClick={() => void supabase?.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </main>
    );

  return (
    <div className={`app-shell${dark ? " theme-dark" : ""}`}>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <button className="brand" onClick={() => switchPage("Dashboard")}>
          <img className="brand-mark" src="/dukaan-pro-mark.svg" alt="" />
          <span className="brand-copy">
            <strong>
              DUKAAN <b>PRO</b>
            </strong>
            <small>STORE MANAGEMENT</small>
          </span>
        </button>
        <button
          className="branch-select"
          onClick={() =>
            notify(
              "Branch switching is available after additional branches are assigned.",
            )
          }
        >
          <span className="branch-dot" />
          <span>
            <small>YOUR BRANCH</small>
            <strong>{branch}</strong>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.heading}>
              <span className="nav-heading">{group.heading}</span>
              {group.items.map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  className={`nav-link${page === name ? " active" : ""}`}
                  onClick={() => switchPage(name)}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{name}</span>
                  {name === "POS" && <span className="nav-live" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-link${page === "Settings" ? " active" : ""}`}
            onClick={() => switchPage("Settings")}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <div className="user-card">
            <div className="avatar">
              {session?.user.email?.slice(0, 2).toUpperCase() ?? "SU"}
            </div>
            <div className="user-copy">
              <strong>
                {session?.user.email?.split("@")[0] ?? "Store user"}
              </strong>
              <span>{session ? "Signed in" : "Account not connected"}</span>
            </div>
            <button
              className="user-more"
              title="Sign out"
              onClick={() => {
                if (supabase) void supabase.auth.signOut();
                else notify("Sign-in is not configured.");
              }}
            >
              <Ellipsis size={18} />
            </button>
          </div>
          <span className="build-label">
            DUKAAN PRO <span>v1.0.0</span>
          </span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>Store</span>
              <ChevronRight size={13} />
              <strong>{page}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query) switchPage("Products");
                }}
                placeholder="Search anything..."
              />
              <kbd>⌘ K</kbd>
            </label>
            <button
              className="language-button"
              onClick={() =>
                setLanguage((value) => (value === "EN" ? "SO" : "EN"))
              }
            >
              {language}
              <ChevronDown size={13} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => switchPage("Notifications")}
            >
              <Bell size={18} />
              <i />
            </button>
            <button
              className="top-avatar"
              onClick={() =>
                notify(session?.user.email ?? "Account not connected")
              }
            >
              {session?.user.email?.slice(0, 2).toUpperCase() ?? "SU"}
            </button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="date-kicker">
                <span className="live-pulse" />{" "}
                {new Date()
                  .toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                  .toUpperCase()}
                <span className="date-divider">·</span> TODAY
              </div>
              <h1>{pageMeta[page][0]}</h1>
              <p>{pageMeta[page][1]}</p>
            </div>
            <div className="heading-actions">
              {page === "Products" && (
                <button
                  className="button button-primary"
                  onClick={() => setProductDialog(null)}
                >
                  <Plus size={16} />
                  Add product
                </button>
              )}
              {page === "Dashboard" && (
                <>
                  <button
                    className="button button-white"
                    onClick={() => switchPage("Reports")}
                  >
                    <FileBarChart size={15} />
                    View reports
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() => switchPage("POS")}
                  >
                    <Plus size={16} />
                    New sale
                  </button>
                </>
              )}
              {page === "Sales" && (
                <button className="button button-white" onClick={exportSales}>
                  <Download size={15} />
                  Export CSV
                </button>
              )}
            </div>
          </div>

          {page === "Dashboard" && (
            <Dashboard
              products={products}
              sales={sales}
              lowStock={lowStock}
              profitsTotal={profitsTotal}
              salesTotal={salesTotal}
              setPeriod={setPeriod}
              period={period}
              switchPage={switchPage}
            />
          )}
          {page === "POS" && (
            <Pos
              products={filteredProducts}
              query={query}
              setQuery={setQuery}
              category={category}
              setCategory={setCategory}
              cart={cart}
              addToCart={addToCart}
              updateQuantity={updateQuantity}
              subtotal={cartSubtotal}
              tax={cartTax}
              total={cartTotal}
              count={cartCount}
              payment={payment}
              setPayment={setPayment}
              amountReceived={amountReceived}
              setAmountReceived={setAmountReceived}
              completeSale={completeSale}
              clearCart={() => setCart([])}
              holdSale={() => {
                if (!cart.length) {
                  notify("Your basket is empty");
                  return;
                }
                setHeldSales((items) => [...items, cart]);
                setCart([]);
                notify("Sale held for later");
              }}
              heldSales={heldSales}
              restoreSale={() => {
                const held = heldSales.at(-1);
                if (held) {
                  setCart(held);
                  setHeldSales((items) => items.slice(0, -1));
                  notify("Held sale restored");
                }
              }}
            />
          )}
          {page === "Products" && (
            <ProductsPage
              products={filteredProducts}
              query={query}
              setQuery={setQuery}
              category={category}
              setCategory={setCategory}
              editProduct={(product) => setProductDialog(product)}
              adjustStock={setStockProduct}
              openBulkImport={() => setBulkImportOpen(true)}
            />
          )}
          {page === "Inventory" && (
            <InventoryPage products={products} adjustStock={setStockProduct} />
          )}
          {page === "Sales" && (
            <SalesPage
              sales={visibleSales}
              query={salesSearch}
              setQuery={setSalesSearch}
              exportSales={exportSales}
            />
          )}
          {page === "Customers" && (
            <ContactsPage
              title="Customers"
              contacts={customers}
              icon="customer"
            />
          )}
          {page === "Suppliers" && (
            <ContactsPage
              title="Suppliers"
              contacts={suppliers}
              icon="supplier"
            />
          )}
          {!(
            [
              "Dashboard",
              "POS",
              "Products",
              "Inventory",
              "Sales",
              "Customers",
              "Suppliers",
            ] as PageKey[]
          ).includes(page) && (
            <ModulePage
              page={page}
              products={products}
              sales={sales}
              categoryRecords={categoryRecords}
              createCategory={createCategory}
              updateCategory={updateCategory}
              deleteCategory={deleteCategory}
              audit={audit}
              notify={notify}
              dark={dark}
              setDark={setDark}
            />
          )}
        </div>
        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Dukaan Pro</span>
          <span>
            <span className="footer-status" />
            All systems operational
          </span>
          <button
            onClick={() =>
              notify("Contact your store administrator for support.")
            }
          >
            <CircleHelp size={14} />
            Help center
          </button>
        </footer>
      </main>

      {productDialog !== undefined && (
        <ProductDialog
          product={productDialog}
          onClose={() => setProductDialog(undefined)}
          onSave={saveProduct}
        />
      )}
      {bulkImportOpen && (
        <BulkProductImport
          products={products}
          categories={categoryRecords.map((item) => item.name)}
          onClose={() => setBulkImportOpen(false)}
          onImport={importProducts}
        />
      )}
      {stockProduct && (
        <StockDialog
          product={stockProduct}
          onClose={() => setStockProduct(null)}
          onSave={saveAdjustment}
        />
      )}
      {lastReceipt && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLastReceipt(null);
          }}
        >
          <section className="modal receipt-modal">
            <div className="receipt-icon">
              <Check size={22} />
            </div>
            <h2>Sale completed</h2>
            <p>Your transaction has been recorded successfully.</p>
            <div className="receipt-number">{lastReceipt.invoice}</div>
            <div className="receipt-summary">
              <span>Total paid</span>
              <strong>{money(lastReceipt.total)}</strong>
            </div>
            <div className="receipt-summary">
              <span>Payment method</span>
              <strong>{lastReceipt.payment}</strong>
            </div>
            <div className="modal-actions">
              <button
                className="button button-white"
                onClick={() => window.print()}
              >
                <Printer size={15} />
                Print receipt
              </button>
              <button
                className="button button-primary"
                onClick={() => setLastReceipt(null)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast">
          <span className="toast-check">
            <Check size={14} />
          </span>
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  products,
  sales,
  lowStock,
  profitsTotal,
  salesTotal,
  setPeriod,
  period,
  switchPage,
}: {
  products: Product[];
  sales: Sale[];
  lowStock: number;
  profitsTotal: number;
  salesTotal: number;
  setPeriod: (value: string) => void;
  period: string;
  switchPage: (page: PageKey) => void;
}) {
  const chartData = getSalesChartData(sales);
  const topProducts = [...products]
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 4);
  return (
    <>
      <section className="metric-grid">
        <Metric
          label="Today's sales"
          value={money(salesTotal)}
          icon={Banknote}
          tone="blue"
          foot="Recorded transactions"
        />
        <Metric
          label="Net profit"
          value={money(profitsTotal)}
          icon={Activity}
          tone="green"
          foot="Based on product costs"
        />
        <Metric
          label="Total products"
          value={products.length.toLocaleString()}
          icon={Package}
          tone="violet"
          foot="In catalog"
        />
        <Metric
          label="Low stock items"
          value={String(lowStock)}
          icon={Boxes}
          tone="orange"
          foot="At or below minimum"
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h2>Sales overview</h2>
              <p>Recorded sales for the selected period</p>
            </div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Chart period"
            >
              <option>This week</option>
              <option>This month</option>
              <option>This year</option>
            </select>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot revenue-dot" />
              Revenue <strong>{money(salesTotal)}</strong>
            </span>
          </div>
          {chartData.length ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 12, right: 4, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="revenueFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#3864ed"
                        stopOpacity={0.16}
                      />
                      <stop offset="95%" stopColor="#3864ed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#edf0f5"
                    strokeDasharray="4 4"
                  />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#98a2b3", fontSize: 11 }}
                    dy={9}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#98a2b3", fontSize: 10 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #edf0f5",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px #15264a12",
                      fontSize: 12,
                    }}
                    formatter={(value) => money(Number(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3864ed"
                    strokeWidth={2.5}
                    fill="url(#revenueFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-empty">
              <FileBarChart size={22} />
              <strong>No sales recorded</strong>
              <span>
                Sales will appear here after your first completed transaction.
              </span>
            </div>
          )}
        </article>
        <article className="panel stock-panel">
          <div className="panel-head">
            <div>
              <h2>Stock watch</h2>
              <p>Items that need your attention</p>
            </div>
            <button
              className="text-button"
              onClick={() => switchPage("Inventory")}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="stock-watch-list">
            {products
              .filter((product) => product.stock <= product.minimum)
              .slice(0, 4)
              .map((product) => (
                <div className="stock-watch-row" key={product.id}>
                  <ProductPhoto product={product} />
                  <div className="stock-watch-name">
                    <strong>{product.name}</strong>
                    <span>{product.sku}</span>
                  </div>
                  <div className="stock-watch-qty">
                    <strong>{product.stock}</strong>
                    <span>left</span>
                  </div>
                  <span
                    className={`badge ${product.stock === 0 ? "badge-red" : "badge-orange"}`}
                  >
                    {product.stock === 0 ? "Out of stock" : "Low stock"}
                  </span>
                </div>
              ))}
          </div>
          <button
            className="stock-action"
            onClick={() => switchPage("Inventory")}
          >
            <span>
              <ArrowDownLeft size={14} />
              {lowStock} products below minimum stock
            </span>
            <ChevronRight size={16} />
          </button>
        </article>
      </section>
      <section className="dashboard-grid lower-grid">
        <article className="panel recent-panel">
          <div className="panel-head">
            <div>
              <h2>Recent sales</h2>
              <p>Your latest transactions</p>
            </div>
            <button className="text-button" onClick={() => switchPage("Sales")}>
              All sales <ArrowRight size={14} />
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>INVOICE</th>
                  <th>CUSTOMER</th>
                  <th>PAYMENT</th>
                  <th>AMOUNT</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {sales.length ? (
                  sales.slice(0, 4).map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <button
                          className="table-link"
                          onClick={() => switchPage("Sales")}
                        >
                          {sale.invoice}
                        </button>
                        <small className="cell-sub">{sale.date}</small>
                      </td>
                      <td>
                        <span className="customer-cell">
                          <span className="mini-avatar">
                            {sale.customer
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                          {sale.customer}
                        </span>
                      </td>
                      <td>
                        <span className="payment-label">{sale.payment}</span>
                      </td>
                      <td className="amount-cell">{money(sale.total)}</td>
                      <td>
                        <span className="badge badge-green">{sale.status}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>
                      <div className="table-empty">No sales recorded yet.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel top-products-panel">
          <div className="panel-head">
            <div>
              <h2>Product snapshot</h2>
              <p>Across your active catalog</p>
            </div>
            <button
              className="text-button"
              onClick={() => switchPage("Products")}
            >
              Catalog <ArrowRight size={14} />
            </button>
          </div>
          {topProducts.length ? (
            topProducts.map((product, index) => (
              <div className="top-product-row" key={product.id}>
                <span className="rank-number">0{index + 1}</span>
                <ProductPhoto product={product} />
                <div className="top-product-name">
                  <strong>{product.name}</strong>
                  <span>{product.category}</span>
                </div>
                <div className="top-product-value">
                  <strong>{money(product.price)}</strong>
                  <span>{product.stock} in stock</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Package size={22} />
              <strong>No products yet</strong>
              <span>
                Your catalog will appear here when products are added.
              </span>
            </div>
          )}
        </article>
      </section>
      <section className="quick-actions">
        <span>QUICK ACTIONS</span>
        <button onClick={() => switchPage("POS")}>
          <span className="quick-icon quick-blue">
            <ShoppingCart size={17} />
          </span>
          <span>
            <strong>Start a sale</strong>
            <small>Open point of sale</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button onClick={() => switchPage("Products")}>
          <span className="quick-icon quick-green">
            <Plus size={18} />
          </span>
          <span>
            <strong>Add a product</strong>
            <small>Update your catalog</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button onClick={() => switchPage("Reports")}>
          <span className="quick-icon quick-orange">
            <FileBarChart size={17} />
          </span>
          <span>
            <strong>View reports</strong>
            <small>Explore store performance</small>
          </span>
          <ArrowRight size={15} />
        </button>
      </section>
    </>
  );
}

function Pos({
  products,
  query,
  setQuery,
  category,
  setCategory,
  cart,
  addToCart,
  updateQuantity,
  subtotal,
  tax,
  total,
  count,
  payment,
  setPayment,
  amountReceived,
  setAmountReceived,
  completeSale,
  clearCart,
  holdSale,
  heldSales,
  restoreSale,
}: {
  products: Product[];
  query: string;
  setQuery: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  cart: CartItem[];
  addToCart: (product: Product) => void;
  updateQuantity: (id: string, amount: number) => void;
  subtotal: number;
  tax: number;
  total: number;
  count: number;
  payment: string;
  setPayment: (value: string) => void;
  amountReceived: string;
  setAmountReceived: (value: string) => void;
  completeSale: () => void;
  clearCart: () => void;
  holdSale: () => void;
  heldSales: CartItem[][];
  restoreSale: () => void;
}) {
  return (
    <div className="pos-layout">
      <section className="panel pos-catalog">
        <div className="pos-toolbar">
          <label className="pos-search">
            <Search size={17} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, SKU or scan barcode"
            />
            <kbd>F2</kbd>
          </label>
          <button className="icon-button filter-button" title="More filters">
            <SlidersHorizontal size={17} />
          </button>
        </div>
        <div className="category-tabs">
          {categories.map((item) => (
            <button
              className={category === item ? "selected" : ""}
              onClick={() => setCategory(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="pos-product-grid">
          {products.map((product) => (
            <button
              className="pos-product"
              key={product.id}
              onClick={() => addToCart(product)}
              disabled={product.stock === 0}
            >
              <ProductPhoto product={product} large />
              <span className="pos-product-info">
                <strong>{product.name}</strong>
                <small>
                  {product.stock} in stock · {product.unit}
                </small>
                <b>{money(product.price)}</b>
              </span>
              <span className="pos-add">
                <Plus size={15} />
              </span>
            </button>
          ))}
          {!products.length && (
            <div className="empty-state">
              <Package size={25} />
              <strong>No products found</strong>
              <span>Try another name or category.</span>
            </div>
          )}
        </div>
      </section>
      <section className="panel cart-panel">
        <div className="cart-heading">
          <div>
            <span className="eyebrow">CURRENT ORDER</span>
            <h2>
              New sale <span className="cart-count">{count}</span>
            </h2>
          </div>
          <button
            className="icon-button"
            title="Clear cart"
            onClick={clearCart}
          >
            <X size={17} />
          </button>
        </div>
        <div className="customer-picker">
          <span className="customer-avatar">W</span>
          <span>
            <strong>Walk-in customer</strong>
            <small>Regular customer</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="cart-lines">
          {cart.map((item) => (
            <div className="cart-line" key={item.product.id}>
              <ProductPhoto product={item.product} />
              <div className="cart-line-copy">
                <strong>{item.product.name}</strong>
                <span>
                  {money(item.product.price)} / {item.product.unit}
                </span>
                <div className="quantity-control">
                  <button
                    onClick={() => updateQuantity(item.product.id, -1)}
                    aria-label="Decrease quantity"
                  >
                    <Minus size={12} />
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.product.id, 1)}
                    aria-label="Increase quantity"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
              <strong className="cart-line-total">
                {money(item.product.price * item.quantity)}
              </strong>
            </div>
          ))}
          {!cart.length && (
            <div className="cart-empty">
              <span className="cart-empty-icon">
                <ShoppingCart size={23} />
              </span>
              <strong>Your basket is empty</strong>
              <span>Choose products to start a sale</span>
            </div>
          )}
        </div>
        <div className="cart-bottom">
          <div className="cart-total-row">
            <span>Subtotal</span>
            <strong>{money(subtotal)}</strong>
          </div>
          <div className="cart-total-row">
            <span>
              Tax <small>5%</small>
            </span>
            <strong>{money(tax)}</strong>
          </div>
          <div className="cart-total-row cart-grand-total">
            <span>Total due</span>
            <strong>{money(total)}</strong>
          </div>
          <span className="payment-caption">PAYMENT METHOD</span>
          <div className="payment-options">
            {["Cash", "Card", "Mobile money"].map((item) => (
              <button
                className={payment === item ? "chosen" : ""}
                key={item}
                onClick={() => setPayment(item)}
              >
                {item === "Cash" ? (
                  <Banknote size={15} />
                ) : item === "Card" ? (
                  <CreditCard size={15} />
                ) : (
                  <Wallet size={15} />
                )}
                {item}
              </button>
            ))}
          </div>
          {payment === "Cash" && (
            <label className="amount-input">
              Amount received
              <input
                type="number"
                min={total}
                step="0.01"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
                placeholder={money(total)}
              />
            </label>
          )}
          <div className="change-row">
            <span>Change</span>
            <strong>
              {money(Math.max(0, Number(amountReceived || total) - total))}
            </strong>
          </div>
          <button
            className="complete-sale"
            disabled={!cart.length}
            onClick={completeSale}
          >
            <Check size={17} />
            Complete sale <span>{money(total)}</span>
          </button>
          <div className="cart-secondary-actions">
            <button onClick={holdSale}>
              <Clock3 size={14} />
              Hold sale
            </button>
            <button onClick={clearCart}>Clear basket</button>
            {heldSales.length > 0 && (
              <button onClick={restoreSale}>
                Resume held ({heldSales.length})
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductsPage({
  products,
  query,
  setQuery,
  category,
  setCategory,
  editProduct,
  adjustStock,
  openBulkImport,
}: {
  products: Product[];
  query: string;
  setQuery: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  editProduct: (product: Product) => void;
  adjustStock: (product: Product) => void;
  openBulkImport?: () => void;
}) {
  return (
    <>
      <section className="catalog-hero">
        <div className="catalog-hero-copy">
          <span className="catalog-hero-icon"><Package size={22} /></span>
          <div><span className="eyebrow">PRODUCT CATALOG</span><h2>Manage your products, prices and availability</h2><p>Keep track of your inventory and manage your product catalog efficiently.</p></div>
        </div>
        <div className="catalog-stats"><div><Package size={16} /><strong>{products.length}</strong><small>Total products</small></div><div><Check size={16} /><strong>{products.filter((product) => product.stock > 0).length}</strong><small>In stock</small></div><div><ShoppingCart size={16} /><strong>{products.filter((product) => product.stock <= product.minimum).length}</strong><small>Low stock</small></div></div>
      </section>
      <section className="panel list-panel">
        <div className="list-toolbar">
        <label className="table-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, SKU or barcode"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button
          className="button button-white"
          onClick={() => setCategory("All items")}
        >
          <Filter size={14} />
          Filters
        </button>
        <span className="result-count">{products.length} products</span>
        {openBulkImport && (
          <button className="button button-primary" onClick={openBulkImport}>
            <Plus size={15} />
            Import products
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>PRODUCT</th>
              <th>SKU / BARCODE</th>
              <th>CATEGORY</th>
              <th>COST</th>
              <th>SELL PRICE</th>
              <th>IN STOCK</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="product-table-cell">
                    <ProductPhoto product={product} />
                    <span>
                      <strong>{product.name}</strong>
                      <small>{product.unit}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <strong className="sku-text">{product.sku}</strong>
                  <small className="cell-sub">
                    {product.barcode || "No barcode"}
                  </small>
                </td>
                <td>
                  <span className="category-tag">{product.category}</span>
                </td>
                <td>{money(product.cost)}</td>
                <td className="amount-cell">{money(product.price)}</td>
                <td>
                  <strong>{product.stock}</strong>
                  <small className="cell-sub">Min. {product.minimum}</small>
                </td>
                <td>
                  <span
                    className={`badge ${product.stock === 0 ? "badge-red" : product.stock <= product.minimum ? "badge-orange" : "badge-green"}`}
                  >
                    {product.stock === 0
                      ? "Out of stock"
                      : product.stock <= product.minimum
                        ? "Low stock"
                        : "In stock"}
                  </span>
                </td>
                <td>
                  <button
                    className="row-action"
                    title="Adjust stock"
                    onClick={() => adjustStock(product)}
                  >
                    <Boxes size={15} />
                  </button>
                  <button
                    className="row-action"
                    title="Edit product"
                    onClick={() => editProduct(product)}
                  >
                    <Ellipsis size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!products.length && (
          <div className="table-empty">No products match your search.</div>
        )}
      </div>
      <div className="table-pagination">
        <span>
          Showing{" "}
          <strong>
            {products.length ? 1 : 0}-{products.length}
          </strong>{" "}
          of <strong>{products.length}</strong> products
        </span>
        <div>
          <button disabled>
            <ChevronLeft size={15} />
          </button>
          <button className="page-number">1</button>
          <button disabled>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      </section>
    </>
  );
}

function InventoryPage({
  products,
  adjustStock,
}: {
  products: Product[];
  adjustStock: (product: Product) => void;
}) {
  return (
    <>
      <div className="inventory-summary">
        <div className="inventory-stat">
          <span>Total units on hand</span>
          <strong>
            {products
              .reduce((total, product) => total + product.stock, 0)
              .toLocaleString()}
          </strong>
          <small>Across {products.length} products</small>
        </div>
        <div className="inventory-stat">
          <span>Low stock alerts</span>
          <strong className="text-orange">
            {
              products.filter(
                (product) =>
                  product.stock > 0 && product.stock <= product.minimum,
              ).length
            }
          </strong>
          <small>Below minimum quantity</small>
        </div>
        <div className="inventory-stat">
          <span>Out of stock</span>
          <strong className="text-red">
            {products.filter((product) => product.stock === 0).length}
          </strong>
          <small>Items requiring restock</small>
        </div>
        <div className="inventory-stat">
          <span>Stock valuation</span>
          <strong>
            {money(
              products.reduce(
                (total, product) => total + product.cost * product.stock,
                0,
              ),
            )}
          </strong>
          <small>At purchase cost</small>
        </div>
      </div>
      <ProductsPage
        products={products}
        query=""
        setQuery={() => {}}
        category="All items"
        setCategory={() => {}}
        editProduct={adjustStock}
        adjustStock={adjustStock}
      />
    </>
  );
}

function SalesPage({
  sales,
  query,
  setQuery,
  exportSales,
}: {
  sales: Sale[];
  query: string;
  setQuery: (value: string) => void;
  exportSales: () => void;
}) {
  return (
    <>
      <div className="sales-kpis">
        <div>
          <span>Gross sales</span>
          <strong>
            {money(sales.reduce((total, sale) => total + sale.total, 0))}
          </strong>
          <small>Today · all payments</small>
        </div>
        <div>
          <span>Transactions</span>
          <strong>{sales.length}</strong>
          <small>Completed sales</small>
        </div>
        <div>
          <span>Average basket</span>
          <strong>
            {money(
              sales.length
                ? sales.reduce((total, sale) => total + sale.total, 0) /
                    sales.length
                : 0,
            )}
          </strong>
          <small>Per transaction</small>
        </div>
        <div>
          <span>Gross profit</span>
          <strong className="text-green">
            {money(sales.reduce((total, sale) => total + sale.profit, 0))}
          </strong>
          <small>Based on product cost</small>
        </div>
      </div>
      <section className="panel list-panel">
        <div className="list-toolbar">
          <label className="table-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoice or customer"
            />
          </label>
          <select aria-label="Date range">
            <option>Today</option>
            <option>This week</option>
            <option>This month</option>
          </select>
          <select aria-label="Payment method">
            <option>All payment methods</option>
            <option>Cash</option>
            <option>Card</option>
            <option>Mobile money</option>
          </select>
          <button className="button button-white" onClick={exportSales}>
            <Download size={14} />
            Export
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>INVOICE</th>
                <th>DATE / TIME</th>
                <th>CUSTOMER</th>
                <th>CASHIER</th>
                <th>PAYMENT</th>
                <th>TOTAL</th>
                <th>PROFIT</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <strong className="table-link">{sale.invoice}</strong>
                  </td>
                  <td>{sale.date}</td>
                  <td>{sale.customer}</td>
                  <td>{sale.cashier}</td>
                  <td>
                    <span className="payment-label">{sale.payment}</span>
                  </td>
                  <td className="amount-cell">{money(sale.total)}</td>
                  <td className="profit-cell">{money(sale.profit)}</td>
                  <td>
                    <span className="badge badge-green">{sale.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sales.length && (
            <div className="table-empty">No sales match this search.</div>
          )}
        </div>
        <div className="table-pagination">
          <span>
            Showing <strong>{sales.length}</strong> transactions
          </span>
          <div>
            <button disabled>
              <ChevronLeft size={15} />
            </button>
            <button className="page-number">1</button>
            <button disabled>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function ContactsPage({
  title,
  contacts,
  icon,
}: {
  title: string;
  contacts: Contact[];
  icon: "customer" | "supplier";
}) {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const filtered = contacts.filter((contact) =>
    `${contact.name} ${contact.detail}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="sales-kpis">
        <div>
          <span>
            {icon === "customer" ? "Active customers" : "Active suppliers"}
          </span>
          <strong>{contacts.length.toLocaleString()}</strong>
          <small>In this branch</small>
        </div>
        <div>
          <span>
            {icon === "customer" ? "Total customer sales" : "Total purchases"}
          </span>
          <strong>
            {money(
              contacts.reduce((total, contact) => total + contact.purchases, 0),
            )}
          </strong>
          <small>Lifetime value</small>
        </div>
        <div>
          <span>Outstanding balance</span>
          <strong className="text-orange">
            {money(
              contacts.reduce((total, contact) => total + contact.balance, 0),
            )}
          </strong>
          <small>Needs follow-up</small>
        </div>
        <div>
          <span>Updated</span>
          <strong>Today</strong>
          <small>Synced just now</small>
        </div>
      </div>
      <section className="panel list-panel">
        <div className="list-toolbar">
          <label className="table-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
            />
          </label>
          <button className="button button-white" onClick={() => setSearch("")}>
            <Filter size={14} />
            Filters
          </button>
          <span className="result-count">{filtered.length} records</span>
          <button
            className="button button-primary"
            onClick={() => setModal(true)}
          >
            <Plus size={15} />
            Add {icon}
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{title.slice(0, -1).toUpperCase()}</th>
                <th>{icon === "customer" ? "TYPE" : "CONTACT"}</th>
                <th>TOTAL {icon === "customer" ? "PURCHASES" : "SPEND"}</th>
                <th>OUTSTANDING</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <div className="contact-table-cell">
                      <span className={`contact-avatar ${icon}`}>
                        {contact.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      <span>
                        <strong>{contact.name}</strong>
                        <small>{contact.id}</small>
                      </span>
                    </div>
                  </td>
                  <td>{contact.detail}</td>
                  <td>{money(contact.purchases)}</td>
                  <td className={contact.balance ? "text-orange" : ""}>
                    {money(contact.balance)}
                  </td>
                  <td>
                    <span
                      className={`badge ${contact.status === "Payment due" || contact.balance ? "badge-orange" : "badge-green"}`}
                    >
                      {contact.status}
                    </span>
                  </td>
                  <td>
                    <button className="row-action" title="View details">
                      <ArrowRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(false);
          }}
        >
          <section className="modal stock-modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">{title.toUpperCase()}</span>
                <h2>Add {icon}</h2>
              </div>
              <button className="icon-button" onClick={() => setModal(false)}>
                <X size={18} />
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                placeholder={`${icon === "customer" ? "Customer" : "Supplier"} name`}
              />
            </label>
            <label>
              Phone or email
              <input placeholder="Contact information" />
            </label>
            <label>
              Address
              <input placeholder="Optional address" />
            </label>
            <div className="modal-actions">
              <button
                className="button button-quiet"
                onClick={() => setModal(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={() => setModal(false)}
              >
                Save {icon}
              </button>
            </div>
            <p className="modal-note">
              Connect Supabase to persist new records to your branch database.
            </p>
          </section>
        </div>
      )}
    </>
  );
}

function ModulePage({
  page,
  products,
  sales,
  categoryRecords,
  createCategory,
  updateCategory,
  deleteCategory,
  audit,
  notify,
  dark,
  setDark,
}: {
  page: PageKey;
  products: Product[];
  sales: Sale[];
  categoryRecords: CategoryRecord[];
  createCategory: (name: string) => Promise<boolean>;
  updateCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  audit: string[];
  notify: (message: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const [setting, setSetting] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const chartData = getSalesChartData(sales);
  const categoryCounts = products.reduce<Record<string, number>>(
    (counts, product) => {
      counts[product.category] = (counts[product.category] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const topCategory = Object.entries(categoryCounts).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const templates: Record<
    string,
    {
      title: string;
      value: string;
      sub: string;
      icon: typeof Wallet;
      tone: string;
    }[]
  > = {
    Categories: [
      {
        title: "Active categories",
        value: String(Object.keys(categoryCounts).length),
        sub: "Across your catalog",
        icon: Boxes,
        tone: "blue",
      },
      {
        title: "Products categorized",
        value: String(products.filter((product) => product.category).length),
        sub: "With a category assigned",
        icon: Package,
        tone: "green",
      },
      {
        title: "Top category",
        value: topCategory?.[0] ?? "—",
        sub: topCategory ? `${topCategory[1]} products` : "No products yet",
        icon: Tag,
        tone: "orange",
      },
    ],
    Brands: [],
    Purchases: [],
    Expenses: [],
    Employees: [],
    "Cash Register": [],
    Reports: [
      {
        title: "Sales this week",
        value: money(sales.reduce((total, sale) => total + sale.total, 0)),
        sub: "Across all payment methods",
        icon: FileBarChart,
        tone: "blue",
      },
      {
        title: "Gross profit",
        value: money(sales.reduce((total, sale) => total + sale.profit, 0)),
        sub: "Revenue less product cost",
        icon: Activity,
        tone: "green",
      },
      {
        title: "Stock valuation",
        value: money(
          products.reduce(
            (total, product) => total + product.stock * product.cost,
            0,
          ),
        ),
        sub: "At purchase cost",
        icon: Boxes,
        tone: "orange",
      },
    ],
    Accounting: [
      {
        title: "Revenue",
        value: money(sales.reduce((total, sale) => total + sale.total, 0)),
        sub: "Sales recorded today",
        icon: ArrowUpRight,
        tone: "blue",
      },
      {
        title: "Cost of goods sold",
        value: money(
          sales.reduce((total, sale) => total + sale.total - sale.profit, 0),
        ),
        sub: "Product cost basis",
        icon: ShoppingBag,
        tone: "orange",
      },
      {
        title: "Gross profit",
        value: money(sales.reduce((total, sale) => total + sale.profit, 0)),
        sub: "Revenue minus COGS",
        icon: Activity,
        tone: "green",
      },
    ],
  };
  const metrics = templates[page];
  const notifications = [
    ...products
      .filter((product) => product.stock <= product.minimum)
      .map((product) => ({
        icon: Boxes,
        color: "orange",
        title: "Stock running low",
        text: `${product.name} · ${product.stock} units remaining.`,
        time: product.sku,
      })),
    ...sales.slice(0, 5).map((sale) => ({
      icon: ShoppingBag,
      color: "green",
      title: "Sale completed",
      text: `${sale.invoice} · ${money(sale.total)}.`,
      time: sale.date,
    })),
  ];
  if (page === "Categories")
    return (
      <section className="panel module-list">
        <div className="panel-head">
          <div>
            <h2>Product categories</h2>
            <p>Organize the products in your branch catalog.</p>
          </div>
        </div>
        <form
          className="list-toolbar"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await createCategory(newCategoryName)) setNewCategoryName("");
          }}
        >
          <input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Category name"
            aria-label="Category name"
          />
          <button
            className="button button-primary"
            type="submit"
            disabled={!newCategoryName.trim()}
          >
            <Plus size={15} />
            Add category
          </button>
        </form>
        <div className="module-category-list">
          {categoryRecords.map((categoryRecord) => (
            <div className="setting-row" key={categoryRecord.id}>
              <input
                defaultValue={categoryRecord.name}
                aria-label={`Edit ${categoryRecord.name}`}
                onKeyDown={async (event) => {
                  if (event.key !== "Enter") return;
                  await updateCategory(
                    categoryRecord.id,
                    event.currentTarget.value,
                  );
                }}
              />
              <div>
                <button
                  className="row-action"
                  title="Save category"
                  onClick={(event) => {
                    const input = event.currentTarget
                      .previousElementSibling as HTMLInputElement | null;
                    if (input) void updateCategory(categoryRecord.id, input.value);
                  }}
                >
                  <Check size={15} />
                </button>
                <button
                  className="row-action"
                  title="Delete category"
                  onClick={() => void deleteCategory(categoryRecord.id)}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
          {!categoryRecords.length && (
            <div className="empty-state">
              <Tag size={24} />
              <strong>No category records</strong>
              <span>Add the first category for this branch.</span>
            </div>
          )}
        </div>
      </section>
    );
  if (page === "Settings")
    return (
      <section className="settings-layout">
        <div className="settings-menu">
          {[
            "Business profile",
            "Point of sale",
            "Taxes & currency",
            "Appearance",
            "Language",
            "Users & roles",
            "Data & backup",
          ].map((item) => (
            <button
              key={item}
              className={
                setting === item || (!setting && item === "Business profile")
                  ? "selected"
                  : ""
              }
              onClick={() => setSetting(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="panel settings-panel">
          <div className="panel-head">
            <div>
              <h2>{setting || "Business profile"}</h2>
              <p>Configure preferences for this store branch.</p>
            </div>
            <button
              className="button button-primary"
              onClick={() => notify("Store preferences saved")}
            >
              <Check size={15} />
              Save changes
            </button>
          </div>
          {(setting || "Business profile") === "Appearance" ? (
            <div className="setting-row">
              <div>
                <strong>Color theme</strong>
                <span>Choose the look that works best for your team.</span>
              </div>
              <button
                className="button button-white"
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
                {dark ? "Light mode" : "Dark mode"}
              </button>
            </div>
          ) : (setting || "Business profile") === "Language" ? (
            <div className="setting-row">
              <div>
                <strong>Display language</strong>
                <span>Choose your preferred interface language.</span>
              </div>
              <select>
                <option>English</option>
                <option>Somali (coming soon)</option>
              </select>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Business name
                  <input placeholder="Business name" />
                </label>
                <label>
                  Branch name
                  <input placeholder="Branch name" />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Business phone
                  <input placeholder="Business phone" />
                </label>
                <label>
                  Currency
                  <select defaultValue="USD · US Dollar">
                    <option>USD · US Dollar</option>
                    <option> SOS · Somali Shilling</option>
                  </select>
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Sales tax</strong>
                  <span>
                    Default tax applied to point-of-sale transactions.
                  </span>
                </div>
                <span className="tax-chip">5%</span>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Data storage</strong>
                  <span>
                    {supabase
                      ? "Connected to your Supabase project."
                      : "Local records are stored in this browser."}
                  </span>
                </div>
                <span
                  className={`badge ${supabase ? "badge-green" : "badge-orange"}`}
                >
                  {supabase ? "Supabase" : "Local storage"}
                </span>
              </div>
            </>
          )}
        </div>
      </section>
    );
  if (page === "Notifications")
    return (
      <div className="notification-list">
        {notifications.map(
          ({ icon: Icon, color, title, text, time }, index) => (
            <article className="panel notification-row" key={title}>
              <span className={`notification-icon ${color}`}>
                <Icon size={17} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
                <small>{time}</small>
              </div>
              {index === 0 && <span className="unread-dot" />}
            </article>
          ),
        )}
        {!notifications.length && (
          <div className="panel empty-state">
            <Bell size={24} />
            <strong>No notifications</strong>
            <span>
              Alerts will appear here when store activity needs your attention.
            </span>
          </div>
        )}
      </div>
    );
  if (page === "Audit Logs")
    return (
      <section className="panel activity-panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p>Important actions performed by your team</p>
          </div>
          <button
            className="button button-white"
            onClick={() => notify("Audit log exported")}
          >
            <Download size={14} />
            Export log
          </button>
        </div>
        {audit.map((item, index) => (
          <div className="activity-row" key={`${item}-${index}`}>
            <span className="activity-avatar">AU</span>
            <div>
              <strong>{item}</strong>
              <span>Recorded activity</span>
            </div>
            <ChevronRight size={15} />
          </div>
        ))}
        {!audit.length && (
          <div className="empty-state">
            <Activity size={24} />
            <strong>No activity recorded</strong>
            <span>
              Actions will appear here once your team starts using the connected
              store.
            </span>
          </div>
        )}
      </section>
    );
  if (metrics)
    return (
      <div className="module-shell">
        <div className="module-metrics">
          {metrics.map(({ title, value, sub, icon: Icon, tone }) => (
            <article className="metric-card" key={title}>
              <div className="metric-top">
                <span>{title}</span>
                <span className={`metric-icon ${tone}`}>
                  <Icon size={17} />
                </span>
              </div>
              <div className="metric-value">{value}</div>
              <div className="metric-foot">{sub}</div>
            </article>
          ))}
        </div>
        {page === "Reports" && (
          <section className="panel report-panel">
            <div className="panel-head">
              <div>
                <h2>Store performance</h2>
                <p>Recorded sales for the selected period</p>
              </div>
              <button
                className="button button-white"
                onClick={() => notify("Your report is being prepared")}
              >
                <Download size={14} />
                Export report
              </button>
            </div>
            {chartData.length ? (
              <div className="chart-wrap report-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid
                      vertical={false}
                      stroke="#edf0f5"
                      strokeDasharray="4 4"
                    />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#3864ed"
                      fill="#3864ed22"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-empty">
                <FileBarChart size={22} />
                <strong>No sales recorded</strong>
                <span>
                  Reports will appear here after transactions are recorded.
                </span>
              </div>
            )}
          </section>
        )}
        {page === "Brands" && (
          <section className="panel module-list">
            <div className="panel-head">
              <div>
                <h2>Product brands</h2>
                <p>Brands linked to your product catalog</p>
              </div>
              <button
                className="button button-primary"
                onClick={() =>
                  notify("Brand form is ready to connect to your database")
                }
              >
                <Plus size={15} />
                Add brand
              </button>
            </div>
            <div className="empty-state">
              <Tag size={24} />
              <strong>No brand records</strong>
              <span>
                Brands will appear here when they are added to your branch
                database.
              </span>
            </div>
          </section>
        )}
        {page === "Purchases" && (
          <section className="panel module-list">
            <div className="panel-head">
              <div>
                <h2>Recent purchase orders</h2>
                <p>Incoming supplier deliveries</p>
              </div>
              <button
                className="button button-primary"
                onClick={() => notify("New purchase order started")}
              >
                <Plus size={15} />
                New purchase
              </button>
            </div>
            <div className="empty-state">
              <ShoppingBag size={24} />
              <strong>No purchase records</strong>
              <span>
                Purchase orders will appear here when they are connected to the
                database.
              </span>
            </div>
          </section>
        )}
        {page === "Expenses" && (
          <section className="panel module-list">
            <div className="panel-head">
              <div>
                <h2>Recent expenses</h2>
                <p>Record and review store operating costs</p>
              </div>
              <button
                className="button button-primary"
                onClick={() => notify("New expense form opened")}
              >
                <Plus size={15} />
                Add expense
              </button>
            </div>
            <div className="empty-state">
              <Wallet size={24} />
              <strong>No expense records</strong>
              <span>
                Expenses will appear here when they are connected to the
                database.
              </span>
            </div>
          </section>
        )}
        {page === "Employees" && (
          <section className="panel module-list">
            <div className="panel-head">
              <div>
                <h2>Team attendance</h2>
                <p>Attendance records from your connected branch.</p>
              </div>
              <button
                className="button button-primary"
                onClick={() => notify("Employee invitation started")}
              >
                <Plus size={15} />
                Add employee
              </button>
            </div>
            <div className="empty-state">
              <Users size={24} />
              <strong>No attendance records</strong>
              <span>
                Employee shifts will appear here when available from your
                database.
              </span>
            </div>
          </section>
        )}
        {page === "Cash Register" && (
          <section className="panel register-panel">
            <div className="register-heading">
              <div>REGISTER DATA</div>
            </div>
            <div className="register-balance">
              <span>No register data is connected.</span>
              <small>
                Opening balance, cash sales, refunds and expenses will appear
                once register records are available.
              </small>
              <button
                className="button button-white"
                onClick={() =>
                  notify(
                    "Connect the cash register workflow to Supabase to open a register.",
                  )
                }
              >
                Open register
              </button>
            </div>
          </section>
        )}
        {page === "Accounting" && (
          <section className="panel report-panel">
            <div className="panel-head">
              <div>
                <h2>Profit & loss</h2>
                <p>
                  Revenue less COGS gives gross profit; operating expenses give
                  net profit.
                </p>
              </div>
              <button
                className="button button-white"
                onClick={() => notify("Profit & loss report exported")}
              >
                <Download size={14} />
                Export
              </button>
            </div>
            <div className="account-lines">
              <div>
                <span>Sales revenue</span>
                <strong>
                  {money(sales.reduce((total, sale) => total + sale.total, 0))}
                </strong>
              </div>
              <div>
                <span>Cost of goods sold</span>
                <strong>
                  −
                  {money(
                    sales.reduce(
                      (total, sale) => total + sale.total - sale.profit,
                      0,
                    ),
                  )}
                </strong>
              </div>
              <div className="account-subtotal">
                <span>Gross profit</span>
                <strong>
                  {money(sales.reduce((total, sale) => total + sale.profit, 0))}
                </strong>
              </div>
              <div>
                <span>Operating expenses</span>
                <strong>Not loaded</strong>
              </div>
              <div className="account-net">
                <span>Net profit</span>
                <strong>Not available</strong>
              </div>
            </div>
          </section>
        )}
        {page !== "Brands" &&
          page !== "Purchases" &&
          page !== "Expenses" &&
          page !== "Employees" &&
          page !== "Cash Register" &&
          page !== "Reports" &&
          page !== "Accounting" && (
            <section className="panel module-list">
              <div className="panel-head">
                <div>
                  <h2>{page} overview</h2>
                  <p>Use the controls above to manage this area.</p>
                </div>
              </div>
              <div className="empty-state">
                <Settings2 size={24} />
                <strong>{page} module</strong>
                <span>
                  Connect a Supabase project to enable shared records and
                  role-aware access.
                </span>
              </div>
            </section>
          )}
      </div>
    );
}

function BulkProductImport({
  products,
  categories,
  onClose,
  onImport,
}: {
  products: Product[];
  categories: string[];
  onClose: () => void;
  onImport: (
    rows: ImportRow[],
    onProgress: (completed: number, total: number) => void,
  ) => Promise<ImportResult>;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [pasteValue, setPasteValue] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parseData = (data: unknown[][]) => {
    const parsed = parseImportRows(data, products);
    setRows(parsed);
    setSelected(new Set(parsed.map((row) => row.rowNumber)));
    setStep("preview");
  };
  const importImmediately = async (parsed: ImportRow[]) => {
    setRows(parsed);
    setSelected(new Set(parsed.map((row) => row.rowNumber)));
    setStep("preview");
    setImporting(true);
    const importResult = await onImport(parsed, (completed, total) =>
      setProgress(total ? Math.round((completed / total) * 100) : 0),
    );
    setResult(importResult);
    setImporting(false);
    setStep("done");
  };
  const readFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseImportRows(
      XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        header: 1,
      }),
      products,
    );
    await importImmediately(parsed);
  };
  const downloadTemplate = () => {
    const sample = [
      ["BUR", "Raashin", "", 20, 25, "KG", "62810001", 100, 10, "Supplier 1", ""],
      ["SOKAR", "Raashin", "", 18, 22, "KG", "62810002", 80, 10, "Supplier 1", ""],
    ];
    const sheet = XLSX.utils.aoa_to_sheet([importHeaders, ...sample]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Products");
    XLSX.writeFile(workbook, "dukaan-products-template.xlsx");
  };
  const visibleRows = rows.filter(
    (row) =>
      `${row.name} ${row.category} ${row.barcode}`.toLowerCase().includes(search.toLowerCase()) &&
      (statusFilter === "all" || row.status === statusFilter),
  );
  const updateRow = (rowNumber: number, patch: Partial<ImportRow>) =>
    setRows((items) => {
      const next = items.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row));
      const editableHeaders = [...importHeaders, "SKU"];
      return parseImportRows([editableHeaders, ...next.map((row) => editableHeaders.map((header) => row[importFieldMap[header.toLowerCase()]] ?? ""))], products);
    });
  const applyBulk = () => {
    setRows((items) => items.map((row) => selected.has(row.rowNumber) ? { ...row, category: bulkCategory || row.category, unit: bulkUnit || row.unit } : row));
  };
  const startImport = async () => {
    const importRows = rows.filter((row) => selected.has(row.rowNumber));
    setImporting(true);
    const importResult = await onImport(importRows, (completed, total) => setProgress(total ? Math.round((completed / total) * 100) : 0));
    setResult(importResult);
    setImporting(false);
    setStep("done");
  };
  const downloadErrors = () => {
    if (!result) return;
    const csv = ["Row Number,Product Name,Error", ...result.errors.map((error) => `${error.rowNumber},"${error.name.replaceAll('"', '""')}","${error.error.replaceAll('"', '""')}"`)].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "dukaan-product-import-errors.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const duplicateCount = rows.filter((row) => row.status === "duplicate").length;
  const missingCount = rows.filter((row) => row.status === "missing").length;
  const invalidCount = rows.filter((row) => row.status === "invalid").length;

  return (
    <div className="modal-backdrop">
      <section className="modal bulk-import-modal">
        <div className="modal-head">
          <div><span className="eyebrow">CATALOG</span><h2>Import products</h2><p>Upload Excel, paste rows, review, then import.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close import"><X size={18} /></button>
        </div>
        <div className="import-steps"><span className={step === "upload" ? "active" : ""}>1 Upload</span><span className={step === "preview" ? "active" : ""}>2 Preview & fix</span><span className={step === "done" ? "active" : ""}>3 Complete</span></div>
        {step === "upload" && (
          <div className="import-upload">
            <label className="import-dropzone">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
              <UploadIcon />
              <strong>Drop Excel or CSV here</strong>
              <span>or click to browse · XLSX, XLS, CSV · max 10 MB</span>
            </label>
            <button className="button button-white" onClick={downloadTemplate}><Download size={15} /> Download Excel template</button>
            <textarea value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder="Paste copied Excel rows here, including the header row" />
            <button className="button button-primary" disabled={!pasteValue.trim()} onClick={() => parseData(XLSX.utils.sheet_to_json(XLSX.read(pasteValue, { type: "string" }).Sheets[XLSX.read(pasteValue, { type: "string" }).SheetNames[0]], { header: 1 }))}>Paste data</button>
          </div>
        )}
        {step === "preview" && (
          <>
            <div className="import-summary"><strong>{rows.length} Products Found</strong><span className="ready">{readyCount} Ready</span><span className="duplicate">{duplicateCount} Duplicates</span><span className="missing">{missingCount} Missing</span><span className="invalid">{invalidCount} Invalid</span></div>
            <div className="import-toolbar"><input placeholder="Search products" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="duplicate">Duplicates</option><option value="missing">Missing</option><option value="invalid">Invalid</option></select><select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}><option value="">Change category...</option>{categories.map((category) => <option key={category}>{category}</option>)}</select><input placeholder="Change unit..." value={bulkUnit} onChange={(event) => setBulkUnit(event.target.value)} /><button className="button button-white" onClick={applyBulk}>Apply to selected</button></div>
            <div className="import-table-wrap"><table className="data-table import-table"><thead><tr><th><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.rowNumber)) : new Set())} /></th><th>#</th><th>Product</th><th>Category</th><th>Cost</th><th>Sale</th><th>Unit</th><th>Barcode</th><th>Stock</th><th>Status</th><th /></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.rowNumber}><td><input type="checkbox" checked={selected.has(row.rowNumber)} onChange={(event) => setSelected((items) => { const next = new Set(items); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; })} /></td><td>{row.rowNumber}</td><td><input value={row.name} onChange={(event) => updateRow(row.rowNumber, { name: event.target.value })} /></td><td><input value={row.category} onChange={(event) => updateRow(row.rowNumber, { category: event.target.value })} /></td><td><input value={row.cost} onChange={(event) => updateRow(row.rowNumber, { cost: event.target.value })} /></td><td><input value={row.price} onChange={(event) => updateRow(row.rowNumber, { price: event.target.value })} /></td><td><input value={row.unit} onChange={(event) => updateRow(row.rowNumber, { unit: event.target.value })} /></td><td><input value={row.barcode} onChange={(event) => updateRow(row.rowNumber, { barcode: event.target.value })} /></td><td><input value={row.stock} onChange={(event) => updateRow(row.rowNumber, { stock: event.target.value })} /></td><td><span className={`badge badge-${row.status === "ready" ? "green" : row.status === "duplicate" ? "orange" : "red"}`}>{row.status === "ready" ? "Ready" : row.status === "duplicate" ? "Duplicate" : row.status === "missing" ? "Missing" : "Invalid"}</span>{row.status === "duplicate" && <select value={row.duplicateChoice} onChange={(event) => updateRow(row.rowNumber, { duplicateChoice: event.target.value as ImportRow["duplicateChoice"] })}><option value="skip">Skip</option><option value="update">Update</option><option value="create">Create new</option></select>}</td><td><button className="row-action" title="Delete row" onClick={() => setRows((items) => items.filter((item) => item.rowNumber !== row.rowNumber))}><X size={14} /></button></td></tr>)}</tbody></table></div>
            {importing && <div className="import-progress"><strong>Importing products... {progress}%</strong><div><span style={{ width: `${progress}%` }} /></div></div>}
            <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={importing || !rows.length || missingCount + invalidCount > 0} onClick={() => void startImport()}>Import {selected.size} products</button></div>
          </>
        )}
        {step === "done" && result && <div className="import-result"><div className="receipt-icon"><Check size={22} /></div><h2>Import completed</h2><p><strong>{result.imported}</strong> products imported · <strong>{result.skipped}</strong> skipped · <strong>{result.failed}</strong> failed</p>{result.errors.length > 0 && <div className="import-error-list">{result.errors.slice(0, 8).map((error) => <div key={`${error.rowNumber}-${error.name}`}><strong>Row {error.rowNumber} · {error.name || "Unnamed product"}</strong><span>{error.error}</span></div>)}</div>}<div className="modal-actions"><button className="button button-white" onClick={downloadErrors} disabled={!result.errors.length}><Download size={15} /> Download error report</button><button className="button button-primary" onClick={onClose}>View products</button></div></div>}
      </section>
    </div>
  );
}

function UploadIcon() {
  return <span className="upload-icon"><Plus size={22} /></span>;
}

export default App;
