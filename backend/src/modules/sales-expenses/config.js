// Stable IDs are stored in records. Labels can change without rewriting history.
// This provisional list must be confirmed with Le Harve before a live rollout.
const departments = [
  { id: 'accommodation', name: 'Accommodation', sales: true, categories: ['cleaning', 'repairs', 'other'] },
  { id: 'kitchen', name: 'Kitchen / Restaurant', sales: true, categories: ['ingredients', 'cooking-fuel', 'cleaning', 'repairs', 'other'] },
  { id: 'bar', name: 'Bar', sales: true, categories: ['drinks', 'cleaning', 'repairs', 'other'] },
  { id: 'laundry', name: 'Laundry', sales: true, categories: ['laundry-supplies', 'repairs', 'other'] },
  { id: 'gym', name: 'Gym', sales: true, categories: ['cleaning', 'repairs', 'other'] },
  { id: 'pool', name: 'Swimming Pool', sales: true, categories: ['pool-supplies', 'cleaning', 'repairs', 'other'] },
  { id: 'general', name: 'General Operations', sales: false, categories: ['diesel', 'utilities', 'repairs', 'other'] },
];
const categories = {
  ingredients: 'Food ingredients', drinks: 'Drinks purchases',
  'cooking-fuel': 'Cooking fuel', cleaning: 'Cleaning supplies',
  'laundry-supplies': 'Laundry supplies', 'pool-supplies': 'Pool supplies',
  diesel: 'Diesel / Generator fuel', utilities: 'Utilities', repairs: 'Repairs', other: 'Other',
};
const enabled = () => process.env.SALES_EXPENSES_ENABLED === 'true';
module.exports = { departments, categories, enabled };
