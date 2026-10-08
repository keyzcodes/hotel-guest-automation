/**
 * Demo hotel information.
 * Amenities, hours, and policies below are sample values.
 * Replace them with hotel-approved details before a live pilot.
 */
module.exports = {
  name: 'The Willows Nest Hotel',
  city: 'Ogbomoso',
  timezone: 'Africa/Lagos',
  isDemo: true,

  googleReviewUrl: 'https://www.google.com/maps/place/The+Willows+Nest+Hotel+Ogbomoso/@8.1670104,3.1078627,9z/data=!4m15!1m2!2m1!1s+The+Willows+Nest+Hotel,!3m11!1s0x10370dbb27a8aa7b:0x25a3060e24f78918!5m2!4m1!1i2!8m2!3d8.1670104!4d4.2614272!9m1!1b1!15sChdUaGUgV2lsbG93cyBOZXN0IEhvdGVsLJIBBWhvdGVs4AEA!16s%2Fg%2F11y_gtg1v7?entry=ttu&g_ep=EgoyMDI2MTAwNS4wIKXMDSoASAFQAw%3D%3D',

  welcomeInfo:
    'Breakfast: 7–10 AM at the restaurant.\n' +
    'Wi-Fi network: Willows-Guest\n' +
    'Wi-Fi password: WelcomeDemo2026\n' +
    'Gym: 6 AM–9 PM. Pool: 7 AM–8 PM.',

  wifi: {
    network: 'Willows-Guest',
    password: 'WelcomeDemo2026',
  },

  services: {
    breakfast: {
      hours: '7 AM–10 AM',
      location: 'Hotel restaurant',
      inclusion: 'Ask staff whether breakfast is included in your booking.',
    },
    restaurant: {
      hours: '7 AM–10 PM',
    },
    roomService: {
      hours: '7 AM–10 PM',
      policy: 'Staff must confirm availability, price, and delivery time.',
    },
    gym: {
      hours: '6 AM–9 PM',
    },
    swimmingPool: {
      hours: '7 AM–8 PM',
    },
    housekeeping: {
      hours: '9 AM–4 PM for routine service',
      policy: 'Additional requests can be submitted through guest chat.',
    },
    reception: {
      hours: '24 hours',
    },
    laundry: {
      policy: 'Staff must confirm collection, price, and return time.',
    },
    airportTransfer: {
      policy: 'Staff must confirm availability, price, and pickup time.',
    },
  },

  policies: {
    checkout: 'Use the checkout time recorded for the guest booking.',
    lateCheckout:
      'Requires staff approval of availability and any applicable charge.',
    requests:
      'Saving a request does not mean staff have accepted or completed it.',
  },
};