/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import CRM from './pages/CRM';
import Dashboard from './pages/Dashboard';
import DropdownManager from './pages/DropdownManager';
import FMSBuilder from './pages/FMSBuilder';
import Forms from './pages/Forms';
import Home from './pages/Home';
import MyTasks from './pages/MyTasks';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Tasks from './pages/Tasks';
import UserManagement from './pages/UserManagement';
import Workflows from './pages/Workflows';
import __Layout from './Layout.jsx';

export const PAGES = {
    "CRM": CRM,
    "Dashboard": Dashboard,
    "DropdownManager": DropdownManager,
    "FMSBuilder": FMSBuilder,
    "Forms": Forms,
    "Home": Home,
    "MyTasks": MyTasks,
    "Notifications": Notifications,
    "Settings": Settings,
    "Tasks": Tasks,
    "UserManagement": UserManagement,
    "Workflows": Workflows,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};