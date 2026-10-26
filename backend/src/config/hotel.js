/**
 * Demo hotel information.
 * Amenities, hours, and policies below are sample values.
 * Replace them with hotel-approved details before a live pilot.
 */
module.exports = {
  name: 'Kudu Demo',
  city: 'Ogbomoso',
  timezone: 'Africa/Lagos',
  isDemo: true,

  // A neutral demo must not direct reviews to a real hotel.
  googleReviewUrl: null,

  welcomeInfo:
    'Breakfast: 7–10 AM at the restaurant.\n' +
    'Wi-Fi network: Kudu-Guest\n' +
    'Wi-Fi password: WelcomeDemo2026\n' +
    'Gym: 6 AM–9 PM. Pool: 7 AM–8 PM.',

  wifi: {
    network: 'Kudu-Guest',
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