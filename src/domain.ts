export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minimum: number;
  image: string;
  imagePath?: string;
  unit: string;
};

export type Sale = {
  id: string;
  invoice: string;
  customer: string;
  cashier: string;
  total: number;
  payment: string;
  date: string;
  status: "Paid" | "Pending";
  profit: number;
};

export type Contact = {
  id: string;
  name: string;
  detail: string;
  purchases: number;
  balance: number;
  status: string;
};

export const categories = [
  "All items",
  "Drinks",
  "Groceries",
  "Dairy",
  "Personal care",
  "Household",
];
