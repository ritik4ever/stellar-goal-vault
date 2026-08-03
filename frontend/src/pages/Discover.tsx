import { useEffect, useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Campaign } from "../types/campaign";
import { listCampaigns } from "../services/api";
import { CampaignCard } from "../components/CampaignCard";
import { SkeletonCard } from "../components/SkeletonCard";
import { EmptyState } from "../components/EmptyState";

type CategoryType = "Tech" | "Art" | "Community" | "Education" | "Environment" | "All";

interface CategoryCardProps {
  category: CategoryType;
  icon: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}

interface DiscoverSection {
  title: string;
  campaigns: Campaign[];
  isLoading: boolean;
}

const CATEGORIES: Array<{ name: CategoryType; icon: string; description: string }> = [
  { name: "All", icon: "🌟", description: "Browse all campaigns" },
  { name: "Tech", icon: "💻", description: "Technology & Innovation" },
  { name: "Art", icon: "🎨", description: "Creative & Artistic Projects" },
  { name: "Community", icon: "🤝", description: "Community Building" },
  { name: "Education", icon: "📚", description: "Learning & Education" },
  { name: "Environment", icon: "🌱", description: "Environmental Initiatives" },
];

function CategoryCard({ category, icon, description, isActive, onClick }: CategoryCardProps) {
  return (
    <button
      type="button"
      className={`category-card ${isActive ? "category-card-active" : ""}`}
      onClick={onClick}
      aria-pressed={isActive}
    >
      <div className="category-icon">{icon}</div>
      <div className="category-content">
        <strong className="category-name">{category}</strong>
        <span className="category-description">{description}</span>
      </div>
    </button>
  );
}

function getRandomFeaturedCampaigns(campaigns: Campaign[], count: number): Campaign[] {
  if (campaigns.length <= count) return campaigns;
  
  // Use current date as seed for daily rotation
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  
  // Simple seeded shuffle
  const shuffled = [...campaigns];
  let random = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    random = (random * 9301 + 49297) % 233280;
    const j = Math.floor((random / 233280) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, count);
}

function getTrendingCampaigns(campaigns: Campaign[]): Campaign[] {
  // Sort by recent activity: percentage funded, pledge count, and recency
  return [...campaigns]
    .filter((c) => c.progress.status === "open")
    .sort((a, b) => {
      // Weighted score based on activity
      const scoreA = a.progress.percentFunded * 0.4 + a.progress.pledgeCount * 0.4 + (a.createdAt / 1000000) * 0.2;
      const scoreB = b.progress.percentFunded * 0.4 + b.progress.pledgeCount * 0.4 + (b.createdAt / 1000000) * 0.2;
      return scoreB - scoreA;
    })
    .slice(0, 6);
}

function getCampaignCategory(campaign: Campaign): CategoryType {
  const title = campaign.title.toLowerCase();
  const description = campaign.description.toLowerCase();
  const content = `${title} ${description}`;

  // Simple keyword-based categorization
  if (/(tech|software|app|code|developer|programming|digital|ai|blockchain)/i.test(content)) {
    return "Tech";
  }
  if (/(art|music|design|creative|artist|paint|sculpture|gallery|exhibition)/i.test(content)) {
    return "Art";
  }
  if (/(community|local|neighborhood|together|social|group|meetup)/i.test(content)) {
    return "Community";
  }
  if (/(education|learn|teach|school|student|course|training|workshop)/i.test(content)) {
    return "Education";
  }
  if (/(environment|green|eco|climate|sustainable|nature|planet|conservation)/i.test(content)) {
    return "Environment";
  }

  return "Community"; // Default category
}

export function Discover() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const categoryParam = (searchParams.get("category") || "All") as CategoryType;

  const [selectedCategory, setSelectedCategory] = useState<CategoryType>(categoryParam);
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  useEffect(() => {
    async function loadCampaigns() {
      setIsLoading(true);
      try {
        const response = await listCampaigns({ limit: 100 });
        setAllCampaigns(response.data);
      } catch (error) {
        console.error("Failed to load campaigns:", error);
      } finally {
        setIsLoading(false);
      }
    }

    void loadCampaigns();
  }, []);

  useEffect(() => {
    setSelectedCategory(categoryParam);
  }, [categoryParam]);

  const handleCategoryClick = (category: CategoryType) => {
    setSelectedCategory(category);
    if (category === "All") {
      searchParams.delete("category");
    } else {
      searchParams.set("category", category);
    }
    setSearchParams(searchParams);
  };

  const handleCampaignSelect = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    navigate(`/campaigns/${campaignId}`);
  };

  const filteredCampaigns = useMemo(() => {
    if (selectedCategory === "All") {
      return allCampaigns;
    }
    return allCampaigns.filter((campaign) => getCampaignCategory(campaign) === selectedCategory);
  }, [allCampaigns, selectedCategory]);

  const featuredCampaigns = useMemo(() => {
    const openCampaigns = allCampaigns.filter((c) => c.progress.status === "open");
    return getRandomFeaturedCampaigns(openCampaigns, 3);
  }, [allCampaigns]);

  const trendingCampaigns = useMemo(() => {
    return getTrendingCampaigns(allCampaigns);
  }, [allCampaigns]);

  const sections: DiscoverSection[] = [
    {
      title: "Featured Campaigns",
      campaigns: featuredCampaigns,
      isLoading,
    },
    {
      title: selectedCategory === "All" ? "Trending Campaigns" : `${selectedCategory} Campaigns`,
      campaigns: selectedCategory === "All" ? trendingCampaigns : filteredCampaigns,
      isLoading,
    },
  ];

  return (
    <div className="discover-page">
      <section className="discover-hero animate-fade-in">
        <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => navigate('/')}
            style={{ minHeight: 40 }}
          >
            ← Back to Control Center
          </button>
        </div>
        <h1 className="discover-title">Discover Campaigns</h1>
        <p className="discover-subtitle">
          Explore innovative projects and support causes you believe in
        </p>
      </section>

      <section className="discover-categories animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <h2 className="section-title">Browse by Category</h2>
        <div className="category-grid">
          {CATEGORIES.map((cat) => (
            <CategoryCard
              key={cat.name}
              category={cat.name}
              icon={cat.icon}
              description={cat.description}
              isActive={selectedCategory === cat.name}
              onClick={() => handleCategoryClick(cat.name)}
            />
          ))}
        </div>
      </section>

      {sections.map((section, index) => (
        <section
          key={section.title}
          className="discover-section animate-fade-in"
          style={{ animationDelay: `${0.2 + index * 0.1}s` }}
        >
          <h2 className="section-title">{section.title}</h2>
          {section.isLoading ? (
            <div className="campaigns-grid">
              {[...Array(3)].map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : section.campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns found"
              message={
                selectedCategory === "All"
                  ? "Check back later for new campaigns"
                  : `No campaigns in the ${selectedCategory} category yet`
              }
            />
          ) : (
            <div className="campaigns-grid">
              {section.campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  selectedCampaignId={selectedCampaignId}
                  onSelect={handleCampaignSelect}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
