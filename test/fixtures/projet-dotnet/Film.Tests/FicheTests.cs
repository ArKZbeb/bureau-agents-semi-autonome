using Xunit;

namespace Film.Tests;

public class FicheTests
{
    [Fact]
    public void Titre_ajoute_l_annee() => Assert.Equal("Vertigo (1958)", Fiche.Titre("Vertigo", 1958));
}
