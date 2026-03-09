---
name: react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# Vercel React Best Practices

Performance optimization guidelines for React and Next.js applications from Vercel Engineering.

## When to Apply

Use this skill when:
- Writing new React components
- Reviewing React/Next.js code
- Refactoring for performance
- Optimizing bundle size
- Implementing data fetching
- Debugging performance issues

## Rule Categories by Priority

### 1. Eliminating Waterfalls (CRITICAL)

**Async as Parallel**
```jsx
// ❌ BAD: Sequential waterfalls
async function Page() {
  const user = await fetchUser();
  const posts = await fetchPosts(user.id); // Waits for user
  return <Profile user={user} posts={posts} />;
}

// ✅ GOOD: Parallel requests
async function Page() {
  const [user, posts] = await Promise.all([
    fetchUser(),
    fetchPosts()
  ]);
  return <Profile user={user} posts={posts} />;
}
```

**Preload Data on Hover**
```jsx
// ✅ Prefetch on hover
<Link 
  href="/dashboard" 
  onMouseEnter={() => prefetch('/api/dashboard')}
>
  Dashboard
</Link>
```

### 2. Bundle Size Optimization (CRITICAL)

**Tree-Shakable Imports**
```tsx
// ❌ BAD: Barrel imports prevent tree-shaking
import { Button } from '@/components';

// ✅ GOOD: Direct imports
import { Button } from '@/components/Button';
```

**Dynamic Imports for Heavy Components**
```tsx
// ✅ Code-split heavy components
const Chart = dynamic(() => import('./Chart'), {
  loading: () => <Skeleton />,
  ssr: false
});
```

**Next.js Font Optimization**
```tsx
// ✅ Use next/font for automatic optimization
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export default function Layout({ children }) {
  return (
    <html className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
```

### 3. Server-Side Performance (HIGH)

**Server Components by Default (Next.js 13+)**
```tsx
// ✅ Server Component (default in app dir)
async function ProductList() {
  const products = await db.products.findMany();
  return products.map(p => <ProductCard key={p.id} {...p} />);
}

// ✅ Client Component only when needed
'use client';
function AddToCartButton({ productId }) {
  return <button onClick={() => addToCart(productId)}>Add</button>;
}
```

**Streaming with Suspense**
```tsx
// ✅ Stream slow components
import { Suspense } from 'react';

export default function Page() {
  return (
    <>
      <Header />
      <Suspense fallback={<Skeleton />}>
        <SlowDataComponent />
      </Suspense>
    </>
  );
}
```

**Server Actions**
```tsx
// ✅ Server Actions for mutations
'use server';
export async function updateProfile(formData: FormData) {
  const name = formData.get('name');
  await db.user.update({ ... });
  revalidatePath('/profile');
}

// Client component
'use client';
export function ProfileForm() {
  return (
    <form action={updateProfile}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
```

### 4. Client-Side Data Fetching (MEDIUM-HIGH)

**React Query / SWR for Client Data**
```tsx
// ✅ Use SWR for client-side fetching
import useSWR from 'swr';

function Profile() {
  const { data, error, isLoading } = useSWR('/api/user', fetcher);
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error />;
  return <div>{data.name}</div>;
}
```

**Optimistic Updates**
```tsx
// ✅ Optimistic UI updates
const { mutate } = useSWR('/api/todos');

async function addTodo(text) {
  // Update UI immediately
  mutate(todos => [...todos, { text, id: Date.now() }], false);
  
  // Then update server
  await fetch('/api/todos', { method: 'POST', body: JSON.stringify({ text }) });
  
  // Revalidate
  mutate();
}
```

### 5. Re-render Optimization (MEDIUM)

**Avoid Inline Functions in JSX**
```tsx
// ❌ BAD: Creates new function on every render
function List({ items }) {
  return items.map(item => (
    <Item onClick={() => handleClick(item.id)} />
  ));
}

// ✅ GOOD: Stable reference
function List({ items }) {
  const handleClick = useCallback((id) => {
    // handle click
  }, []);
  
  return items.map(item => (
    <Item onClick={handleClick} id={item.id} />
  ));
}
```

**React.memo for Expensive Components**
```tsx
// ✅ Memoize expensive components
const ExpensiveComponent = React.memo(({ data }) => {
  return <ComplexVisualization data={data} />;
}, (prevProps, nextProps) => {
  return prevProps.data === nextProps.data;
});
```

**useMemo for Expensive Calculations**
```tsx
// ✅ Memoize expensive calculations
function DataTable({ rows }) {
  const sortedRows = useMemo(() => {
    return rows.sort((a, b) => a.value - b.value);
  }, [rows]);
  
  return <Table data={sortedRows} />;
}
```

### 6. Rendering Performance (MEDIUM)

**Key Prop for Lists**
```tsx
// ❌ BAD: Index as key
{items.map((item, i) => <Item key={i} {...item} />)}

// ✅ GOOD: Stable unique identifier
{items.map(item => <Item key={item.id} {...item} />)}
```

**Virtualization for Long Lists**
```tsx
// ✅ Virtualize long lists
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={50}
    >
      {({ index, style }) => (
        <div style={style}>{items[index].name}</div>
      )}
    </FixedSizeList>
  );
}
```

### 7. JavaScript Performance (LOW-MEDIUM)

**Debounce/Throttle User Input**
```tsx
// ✅ Debounce search input
import { useDebouncedCallback } from 'use-debounce';

function SearchInput() {
  const debounced = useDebouncedCallback(
    (value) => fetch(`/api/search?q=${value}`),
    300
  );
  
  return <input onChange={(e) => debounced(e.target.value)} />;
}
```

### 8. Advanced Patterns (LOW)

**Error Boundaries**
```tsx
// ✅ Wrap components with error boundaries
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
```

## Next.js Specific

### Route Handlers (App Router)
```ts
// app/api/users/route.ts
export async function GET(request: Request) {
  const users = await db.user.findMany();
  return Response.json(users);
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await db.user.create({ data: body });
  return Response.json(user, { status: 201 });
}
```

### Metadata API
```tsx
// ✅ SEO optimization with Metadata API
export const metadata = {
  title: 'Dashboard',
  description: 'User dashboard',
  openGraph: {
    images: ['/og-image.png'],
  },
};
```

### Image Optimization
```tsx
// ✅ Use Next.js Image component
import Image from 'next/image';

<Image
  src="/photo.jpg"
  alt="Photo"
  width={500}
  height={300}
  priority // For LCP images
/>
```

## Performance Checklist

- [ ] Use Server Components by default (Next.js 13+)
- [ ] Minimize 'use client' boundaries
- [ ] Use direct imports instead of barrel files
- [ ] Dynamic import heavy/rarely-used components
- [ ] Implement proper loading states with Suspense
- [ ] Use next/image for all images
- [ ] Use next/font for font optimization
- [ ] Implement proper error boundaries
- [ ] Add appropriate React.memo/useMemo
- [ ] Use SWR/React Query for client data fetching
- [ ] Implement optimistic UI updates
- [ ] Virtualize long lists
- [ ] Debounce/throttle user inputs
- [ ] Use stable keys in lists
- [ ] Avoid inline functions in JSX props
- [ ] Run parallel async operations with Promise.all

## AeroCert Dev Workflow (CRITICAL)

This project runs as a **unified monolith**: the Express backend serves the compiled React frontend from `dist/`. There is **no hot-reload** for frontend changes.

**After any React/JSX/CSS change, you MUST:**
```powershell
# 1. Build the frontend
npm run build

# 2. Restart the server (kills existing node process first)
taskkill /F /IM node.exe 2>$null; Start-Sleep 1; node backend/server.js
```

> ⚠️ If you only restart the server without rebuilding, the browser will still see the OLD frontend. Always build first.

Backend-only changes (routes, services, etc.) only require a server restart — no build needed.

## Tools & Debugging

**Analyze Bundle**
```bash
npm run build  # Vite build — outputs to dist/
```

**React DevTools Profiler**
- Record component render times
- Identify unnecessary re-renders
- Find slow components

**Lighthouse CI**
- Automate performance testing
- Track Core Web Vitals
- Catch regressions

## References

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Vercel Performance Best Practices](https://vercel.com/docs/concepts/next.js/performance)
- [Web.dev Performance](https://web.dev/performance/)
