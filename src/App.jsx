import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { StoreProvider } from './context/StoreContext'
import StoreSelectScreen from './screens/StoreSelectScreen'
import MainMenuScreen from './screens/MainMenuScreen'
import InvoiceScreen from './screens/InvoiceScreen'
import PriceAlertsScreen from './screens/PriceAlertsScreen'
import VendorScreen from './screens/VendorScreen'
import VendorDetailScreen from './screens/VendorDetailScreen'
import InventoryScreen from './screens/InventoryScreen'
import InventoryDetailScreen from './screens/InventoryDetailScreen'
import RecipeScreen from './screens/RecipeScreen'
import RecipeDetailScreen from './screens/RecipeDetailScreen'
import MatchingScreen from './screens/MatchingScreen'
import CostScreen from './screens/CostScreen'
import CostDetailScreen from './screens/CostDetailScreen'

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StoreSelectScreen />} />
          <Route path="/menu" element={<MainMenuScreen />} />
          <Route path="/invoices" element={<InvoiceScreen />} />
          <Route path="/price-alerts" element={<PriceAlertsScreen />} />
          <Route path="/vendors" element={<VendorScreen />} />
          <Route path="/vendors/:vendorId" element={<VendorDetailScreen />} />
          <Route path="/inventory" element={<InventoryScreen />} />
          <Route path="/inventory/:itemName/:unit" element={<InventoryDetailScreen />} />
          <Route path="/recipes" element={<RecipeScreen />} />
          <Route path="/recipes/:menuName" element={<RecipeDetailScreen />} />
          <Route path="/ingredient-matching" element={<MatchingScreen />} />
          <Route path="/cost" element={<CostScreen />} />
          <Route path="/cost/:menuName" element={<CostDetailScreen />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  )
}
